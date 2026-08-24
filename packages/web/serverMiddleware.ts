/**
 * serverMiddleware.ts — the studio's server-side playback engine.
 *
 * Vite dev-server plugin that lets the browser hand a score to *this* machine
 * and have it sound here: either through the server's speakers — rendered
 * offline with the same synth presets and sample libraries the browser uses,
 * see serverAudio.ts — or out of its hardware/virtual MIDI ports into whatever
 * rack is listening. A single score can do both at once; the routing panel
 * decides per track.
 *
 * The browser never polls. `/api/server-events` is a Server-Sent Events stream
 * carrying one unified snapshot of everything the studio needs to render —
 * device list, transport state, playhead position — pushed on every change and
 * ~10×/s while the transport runs.
 *
 * Rendering is decoupled from the transport. `/api/server-prepare` compiles the
 * score, builds its MIDI event list and renders every audio chunk into one
 * finished PCM buffer, which sits here until something asks for it; the studio
 * calls it on its own whenever the score settles, so by the time anyone presses
 * Play there is nothing left to compute and `/api/server-play` only has to open
 * the ports and start the clock. With Speaker set to Client the browser pulls
 * that same buffer down over `/api/server-audio-buffer` ahead of time and plays
 * it locally.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseYaml,
  compileDoc,
  tempoSegments,
  beatsToSeconds,
  secondsToBeats,
  songEndBeat,
  panicMessages,
  encodeControlMessage,
  ControlOp,
  rackChannelMap,
  readinessRequest,
  decodeReadiness,
  patchMessage,
  // Straight from core's source, not its dist: vite bundles this config file
  // with esbuild, so a relative import is inlined and core edits take effect
  // without a `npm run build -w core` first (the same deal the app's alias
  // gives src/). Importing '@play.yaml/core' here would silently pin the
  // engine to a stale dist.
} from '../core/src/index';
import type { CompiledSong, RackChannels } from '../core/src/index';
import {
  audioRenderingAvailable, createChunkedRender, playPcm, renderSongToPcm, resolveVpoFile, vpoRoot,
  type PcmPlayback,
} from '@play.yaml/node-audio';
import type { TempoSegment } from '../core/src/time';

// Both are CommonJS: importing them from ESM lands the real module object on
// `.default` at runtime even though the types describe the namespace.
type EasyMidi = typeof import('easymidi');
type MidiOutput = InstanceType<EasyMidi['Output']>;
type MidiInput = InstanceType<EasyMidi['Input']>;

let easymidi: EasyMidi | null = null;
try {
  const mod = await import('easymidi');
  easymidi = (((mod as any).default ?? mod) as EasyMidi);
} catch {
  // No MIDI bindings on this machine — Web Audio output still works.
}


/** The pseudo-port that means "render on the server's own speakers". */
export const WEBAUDIO_ID = 'Server Audio Output (Web Audio)';

/** Notes are scheduled this far ahead so the first one is never late. */
const LEAD_SEC = 0.15;
/** Silence held after the last note before a pass is considered finished. */
const TAIL_SEC = 0.3;

/**
 * MPE lower zone: channel 1 is the master (zone-wide messages), channels 2-16
 * are member channels, one sounding note each, which is what buys a synth
 * per-note pitch bend and pressure.
 */
const MPE_MASTER_CH = 0;
const MPE_MEMBER_CHANNELS = Array.from({ length: 15 }, (_, i) => i + 1);

export interface ServerPortInfo {
  id: string;
  name: string;
  rawName: string;
  mpe: boolean;
  /** Channel → instrument name, when this port is a jukebox rack's input. */
  channels: Record<number, string>;
  /** True for the port the running rack listens on. */
  rack: boolean;
}

/** One rack channel as the studio sees it: what is there, and whether it will sound. */
export interface RackChannelInfo {
  channel: number;
  name: string;
  format: string;
  loaded: boolean;
  /** Last CC 119 report; null until the rack has said anything about it. */
  ready: boolean | null;
}

export interface RackSnapshot {
  available: boolean;
  /** The ALSA loopback the rack plays from — "Midi Through Port-0". */
  through: string;
  channels: RackChannelInfo[];
  /** Channels a play is currently waiting on. */
  warming: number[];
}

/** How far along the standing render is — see `prepareOnServer`. */
export interface PreparedStatus {
  status: 'idle' | 'rendering' | 'ready' | 'error';
  /** 0-1 while rendering, 1 once ready. */
  progress: number;
  /**
   * Fingerprint of the score and routing this render covers. The studio holds
   * a copy of the audio in Client speaker mode and compares keys to know
   * whether what it has still matches what the server would play.
   */
  key: string;
  /** False when every track is routed out to MIDI and nothing was rendered. */
  hasAudio: boolean;
  durationSec: number;
  error: string | null;
}

/** The single shape the SSE stream (and the REST endpoints) hand the studio. */
export interface ServerSnapshot {
  available: boolean;
  ports: ServerPortInfo[];
  /** Port ids, for callers that only want the list. */
  midiDevices: string[];
  playing: boolean;
  device: string;
  volume: number;
  loop: boolean;
  /** Playhead in quarter notes, so the studio can highlight and monitor. */
  positionBeats: number;
  totalBeats: number;
  prepared: PreparedStatus;
  rack: RackSnapshot;
  error: string | null;
}

// ────────────────────────────── the rack's caches ──────────────────────────────

/**
 * jukebox writes what it is hosting to `~/.cache/jukebox/` — `channels.json`
 * for the channel map, `surfaces.json` for the tweakable options — because a
 * MIDI cable carries no way to ask. Both are re-read when their mtime moves;
 * an absent file is the normal state and means no rack is running.
 */
function cacheFile(name: string): string {
  const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cache, 'jukebox', name);
}

const cacheReads = new Map<string, { mtime: number; value: unknown }>();

function readCache<T>(name: string): { value: T | null; error: string } {
  const file = cacheFile(name);
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const held = cacheReads.get(file);
    if (held && held.mtime === mtime) return { value: held.value as T, error: '' };
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    cacheReads.set(file, { mtime, value });
    return { value, error: '' };
  } catch (err: any) {
    cacheReads.delete(file);
    return {
      value: null,
      error: err?.code === 'ENOENT'
        ? `no rack has published to ${file} — start jukebox to see its instruments`
        : String(err?.message ?? err),
    };
  }
}

export function readRackChannels(): { rack: RackChannels | null; error: string } {
  const { value, error } = readCache<RackChannels>('channels.json');
  return { rack: value, error };
}

export function readSurfaceCatalogue(): { catalogue: unknown; error: string } {
  const { value, error } = readCache<unknown>('surfaces.json');
  return { catalogue: value, error };
}

/**
 * Readiness reports, live. The rack answers CC 119 on `jukebox-status` for
 * anything subscribed there; this keeps one subscription open for the life of
 * the server so the studio always knows which channels will sound, not only
 * during a play. The port comes and goes with the rack, hence the retry from
 * the device rescan.
 */
const rackReady = new Map<number, boolean>();
let statusInput: MidiInput | null = null;
let statusPortName = '';

function ensureStatusListener(): void {
  if (!easymidi) return;
  const inputs = easymidi.getInputs();
  const wanted = inputs.find((name: string) => /jukebox-status/i.test(name)) ?? '';
  if (statusInput && wanted === statusPortName) return;
  if (statusInput) {
    try { statusInput.close(); } catch {}
    statusInput = null;
    statusPortName = '';
    // A rack that went away took its readiness with it.
    rackReady.clear();
  }
  if (!wanted) return;
  try {
    statusInput = new easymidi.Input(wanted);
    statusPortName = wanted;
    statusInput.on('cc', (msg: { controller: number; value: number; channel: number }) => {
      const report = decodeReadiness([0xb0 | msg.channel, msg.controller, msg.value]);
      if (!report) return;
      const before = rackReady.get(report.channel);
      rackReady.set(report.channel, report.ready);
      if (before !== report.ready) broadcast();
    });
  } catch (err) {
    console.warn('[server-middleware] could not open the rack status port:', err);
    statusInput = null;
  }
}

/** Channels a play is waiting on; empty outside the warm-up. */
let warming: number[] = [];

export function rackSnapshot(): RackSnapshot {
  const { rack } = readRackChannels();
  const port = rack?.ports?.[0];
  const map = rackChannelMap(rack);
  const channels: RackChannelInfo[] = [];
  for (const [channel, instrument] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    channels.push({
      channel,
      name: instrument.name,
      format: instrument.format,
      loaded: Boolean(instrument.loaded),
      ready: rackReady.get(channel) ?? null,
    });
  }
  return { available: Boolean(port), through: port?.through ?? '', channels, warming };
}

// Scanning ALSA on every stream tick would be wasteful; the device list only
// changes when someone plugs something in.
let portsCache: { at: number; ports: ServerPortInfo[] } | null = null;
const PORTS_TTL_MS = 2000;

export function getServerPortsInfo(force = false): ServerPortInfo[] {
  if (!force && portsCache && Date.now() - portsCache.at < PORTS_TTL_MS) return portsCache.ports;

  const { rack } = readRackChannels();
  const through = rack?.ports?.[0]?.through ?? '';
  const channelNames: Record<number, string> = {};
  for (const [channel, instrument] of rackChannelMap(rack)) channelNames[channel] = instrument.name;

  const result: ServerPortInfo[] = [
    { id: WEBAUDIO_ID, name: WEBAUDIO_ID, rawName: WEBAUDIO_ID, mpe: false, channels: {}, rack: false },
  ];

  try {
    ensureStatusListener();
    const outputs = easymidi?.getOutputs?.() ?? [];
    for (const rawOutput of outputs) {
      // ALSA decorates the name ("Midi Through:Midi Through Port-0 14:0");
      // the rack names the stable part of it.
      const isRack = Boolean(through) && rawOutput.includes(through);
      result.push({
        id: rawOutput,
        name: isRack ? `${rack!.ports[0].port} (${through})` : rawOutput,
        rawName: rawOutput,
        mpe: false,
        channels: isRack ? channelNames : {},
        rack: isRack,
      });
    }
  } catch (err) {
    console.warn('[server-middleware] Error building server ports info:', err);
  }

  portsCache = { at: Date.now(), ports: result };
  return result;
}

/** The server's output whose name carries the rack's loopback, if any. */
function rackPortId(): string | null {
  return getServerPortsInfo().find((p) => p.rack)?.id ?? null;
}

// ──────────────────────────── transport state ────────────────────────────

interface ActivePlayback {
  stop: () => void;
  /** Wall-clock ms at which beat 0 of the current pass sounds. */
  passStartMs: number;
  passDurationSec: number;
  segments: TempoSegment[];
  totalBeats: number;
  /** Live volume hooks, so the master slider moves what is already sounding. */
  setVolume: (volume: number) => void;
}

const state = {
  playing: false,
  device: WEBAUDIO_ID,
  volume: 1.0,
  loop: false,
  error: null as string | null,
};

let active: ActivePlayback | null = null;

function positionBeats(): number {
  if (!active || !state.playing) return 0;
  const elapsedSec = (Date.now() - active.passStartMs) / 1000;
  const beat = secondsToBeats(active.segments, elapsedSec);
  return Math.max(0, Math.min(active.totalBeats, beat));
}

export function snapshot(): ServerSnapshot {
  const ports = getServerPortsInfo();
  return {
    available: true,
    ports,
    midiDevices: ports.map((p) => p.id),
    playing: state.playing,
    device: state.device,
    volume: state.volume,
    loop: state.loop,
    positionBeats: positionBeats(),
    totalBeats: active?.totalBeats ?? 0,
    prepared: preparedStatus(),
    rack: rackSnapshot(),
    error: state.error,
  };
}

// ────────────────────────────── SSE broadcast ──────────────────────────────

const clients = new Set<ServerResponse>();
let ticker: NodeJS.Timeout | null = null;
let tickCount = 0;

function send(res: ServerResponse, snap: ServerSnapshot): void {
  try {
    res.write(`event: state\ndata: ${JSON.stringify(snap)}\n\n`);
  } catch {
    clients.delete(res);
  }
}

/** Push the current snapshot to every connected studio. */
function broadcast(): void {
  if (!clients.size) return;
  const snap = snapshot();
  for (const res of clients) send(res, snap);
}

/**
 * One shared timer drives the stream: fast while the transport runs (so the
 * playhead is smooth), a slow heartbeat otherwise (so a newly plugged-in
 * device shows up without anyone asking).
 */
function ensureTicker(): void {
  if (ticker || !clients.size) return;
  ticker = setInterval(() => {
    tickCount++;
    if (state.playing) {
      broadcast();
    } else if (tickCount % 20 === 0) {
      getServerPortsInfo(true); // rescan for hot-plugged gear
      broadcast();
    }
  }, 100);
}

function stopTickerIfIdle(): void {
  if (ticker && !clients.size) {
    clearInterval(ticker);
    ticker = null;
  }
}

// ──────────────────────────── playback engine ────────────────────────────

/** Where one compiled track should sound. */
interface Target {
  portId: string;
  channel: number; // 0-15
  mpe: boolean;
  /** The port is a jukebox rack: patches and readiness apply. */
  rack: boolean;
}

export interface ServerRoute {
  outputId: string;
  channel: number; // 1-16
}

interface MidiEvent {
  sec: number;
  /** Note-offs before note-ons at the same instant; CCs ahead of both. */
  order: number;
  portId: string;
  kind: 'noteon' | 'noteoff' | 'cc' | 'sysex';
  payload: Record<string, number>;
  /**
   * The CC7 preamble carries master volume, which the user can move while the
   * transport runs. Looping replays the preamble, so its value is resolved at
   * send time rather than baked in — otherwise every lap snaps back to the
   * volume the score started at.
   */
  liveVolume?: true;
}

/**
 * Hand out MPE member channels: prefer one whose previous note has already
 * ended, else steal the one that frees up soonest.
 */
function makeMpeAllocator() {
  const freeAt = new Array(MPE_MEMBER_CHANNELS.length).fill(-Infinity);
  return (startSec: number, endSec: number): number => {
    let chosen = -1;
    for (let i = 0; i < freeAt.length; i++) {
      if (freeAt[i] <= startSec) {
        chosen = i;
        break;
      }
    }
    if (chosen < 0) {
      chosen = 0;
      for (let i = 1; i < freeAt.length; i++) if (freeAt[i] < freeAt[chosen]) chosen = i;
    }
    freeAt[chosen] = endSec;
    return MPE_MEMBER_CHANNELS[chosen];
  };
}

/** The routing key for a compiled track — mirrors the studio's routeKey(). */
function trackRouteKey(track: { sample?: string; kit?: string }): string {
  return track.kit ?? track.sample ?? 'piano';
}

function resolveTargets(
  song: CompiledSong,
  routes: Record<string, ServerRoute>,
  defaultDevice: string,
  ports: ServerPortInfo[],
): Target[] {
  const portById = new Map(ports.map((p) => [p.id, p]));
  return song.tracks.map((track) => {
    const route = routes[trackRouteKey(track)];
    // A route left over from WebMIDI mode names a port id this machine has
    // never heard of; fall back to the chosen device rather than conjuring a
    // virtual ALSA port out of a browser's id string.
    const port = route ? portById.get(route.outputId) : undefined;
    const portId = port?.id ?? defaultDevice;
    return {
      portId,
      channel: (((route?.channel ?? track.channel ?? 1) - 1) & 0x0f),
      mpe: Boolean((port ?? portById.get(portId))?.mpe),
      rack: Boolean((port ?? portById.get(portId))?.rack),
    };
  });
}

export function stopServerPlayback(): void {
  if (active) {
    try {
      active.stop();
    } catch (err) {
      console.warn('[server-middleware] Error stopping server playback:', err);
    }
    active = null;
  }
  state.playing = false;
  broadcast();
}

// ───────────────────────────── prepared render ─────────────────────────────

/** Everything a pass needs, worked out before anyone presses Play. */
interface Plan {
  key: string;
  song: CompiledSong;
  segments: TempoSegment[];
  totalBeats: number;
  passDurationSec: number;
  fromBeat: number;
  device: string;
  events: MidiEvent[];
  /** Ports the pass will open — resolved here, opened at play time. */
  midiPortIds: Set<string>;
  /** (port → channels) that carry CC7, so a volume move can reach them. */
  volumeChannels: Map<string, Set<number>>;
  audioTrackNames: string[];
  /**
   * What the rack has to have in place before the clock starts: the patch
   * each channel should be switched to (or null to leave it), for every rack
   * channel the pass plays. Warmed and waited on by playOnServer.
   */
  rackChannels: Map<number, number | null>;
}

interface PreparedAudio {
  /** Interleaved stereo float, the whole pass. */
  pcm: Float32Array;
  sampleRate: number;
  channels: number;
  durationSec: number;
  /** The same samples as 16-bit LE, encoded on first request and kept. */
  s16?: Buffer;
}

interface Prepared {
  key: string;
  plan: Plan | null;
  status: 'rendering' | 'ready' | 'error';
  progress: number;
  error: string | null;
  audio: PreparedAudio | null;
  /** Resolves once this entry is no longer `rendering`. */
  ready: Promise<Prepared>;
}

/**
 * The one standing render. Only the newest survives: a score that has been
 * edited is a different score, and holding its predecessor's audio would only
 * mean handing the browser something it is no longer looking at.
 */
let prepared: Prepared | null = null;

/**
 * What identifies a render. Volume, loop and speaker are deliberately absent —
 * none of them change a sample, they only change what happens to the finished
 * audio, so a change to any of them must not throw the render away.
 */
function planKey(opts: {
  code: string;
  device?: string;
  routes?: Record<string, ServerRoute>;
  fromBeat?: number;
}): string {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
      code: opts.code,
      device: opts.device || WEBAUDIO_ID,
      routes: opts.routes ?? {},
      fromBeat: opts.fromBeat ?? 0,
    }))
    .digest('hex');
}

function preparedStatus(): PreparedStatus {
  if (!prepared) {
    return { status: 'idle', progress: 0, key: '', hasAudio: false, durationSec: 0, error: null };
  }
  return {
    status: prepared.status,
    progress: prepared.progress,
    key: prepared.key,
    hasAudio: Boolean(prepared.audio),
    durationSec: prepared.audio?.durationSec ?? prepared.plan?.passDurationSec ?? 0,
    error: prepared.error,
  };
}

/**
 * Compile a score into a pass: the MIDI event list, and which tracks the
 * server has to render itself. Opens nothing and sounds nothing — this is the
 * half of the old playOnServer that has no side effects, so it can run
 * whenever the score changes rather than only on Play.
 */
function buildPlan(opts: {
  code: string;
  device?: string;
  routes?: Record<string, ServerRoute>;
  fromBeat?: number;
}): Plan {
  const doc = parseYaml(opts.code);
  if (!doc || typeof doc !== 'object' || (doc.play == null && doc.tracks == null)) {
    throw new Error('Invalid score: missing play or tracks definition');
  }
  const song = compileDoc(doc);

  const ports = getServerPortsInfo(true);
  const device = opts.device || WEBAUDIO_ID;
  const routes = opts.routes ?? {};
  const fromBeat = opts.fromBeat ?? 0;

  const targets = resolveTargets(song, routes, device, ports);
  const segments = tempoSegments(song.bpm || 120, song.tempoMap);
  const totalBeats = songEndBeat(song);
  const skipSec = beatsToSeconds(segments, fromBeat);
  const passDurationSec =
    Math.max(0, beatsToSeconds(segments, totalBeats) - skipSec) + TAIL_SEC;

  // ── the outputs this score will need ──
  const midiPortIds = new Set(
    targets.filter((t) => t.portId !== WEBAUDIO_ID).map((t) => t.portId),
  );

  /*
   * The rack's control port, if it has one. Preset and sound changes are named
   * rather than numbered, so they cannot ride a channel-voice message and go
   * here as SysEx instead. Found by name because that is what a rack advertises
   * it as; a rack without one just never receives them.
   */
  /*
   * Which port the SysEx addresses *inside* the rack. Index 0 is the rack's
   * default port — the one every channel-mapped instrument lives on — and this
   * server only ever routes to that one.
   */
  const CONTROL_PORT_INDEX = 0;
  const wantsPatches = song.tracks.some((t) => (t.patches ?? []).length > 0);
  const controlPortId = wantsPatches && easymidi
    ? easymidi.getOutputs().find((name: string) => /control/i.test(name)) ?? null
    : null;
  if (controlPortId) midiPortIds.add(controlPortId);

  // Tracks routed to the server's own speakers are rendered to PCM ahead of
  // time by prepareOnServer; the ones below go out as MIDI.
  const audioTrackNames = song.tracks
    .filter((_, i) => targets[i].portId === WEBAUDIO_ID)
    .map((t) => t.name);

  // ── build one pass of MIDI events, in seconds from the top of the pass ──
  // CC7's value here is a placeholder: it is flagged `liveVolume` and resolved
  // from the master slider at send time, so the plan does not depend on volume.
  const initialCc7 = 127;
  const events: MidiEvent[] = [];
  const mpeAllocators = new Map<string, ReturnType<typeof makeMpeAllocator>>();
  const zoneInitPorts = new Set<string>();
  // Which (port, channel) pairs are live, so a volume move can reach them.
  const volumeChannels = new Map<string, Set<number>>();
  const rackChannels = new Map<number, number | null>();

  const markVolumeChannel = (portId: string, channel: number) => {
    let set = volumeChannels.get(portId);
    if (!set) volumeChannels.set(portId, (set = new Set()));
    set.add(channel);
  };

  song.tracks.forEach((track, i) => {
    const target = targets[i];
    if (target.portId === WEBAUDIO_ID) return;

    // Zone-wide messages (and the score's own control curves) ride the master
    // channel on an MPE port; on a normal port they ride the track's channel.
    const controlCh = target.mpe ? MPE_MASTER_CH : target.channel;
    if (target.mpe) zoneInitPorts.add(target.portId);
    markVolumeChannel(target.portId, controlCh);
    if (target.rack && !target.mpe) {
      // A declared patch wins over another track's silence on the same channel.
      const declared = track.patch ?? null;
      if (declared !== null || !rackChannels.has(target.channel + 1)) {
        rackChannels.set(target.channel + 1, declared);
      }
    }

    // CC7 carries the master volume. Everything else — expression, pedal,
    // playmode, bow pressure — is the composer's data and is sent verbatim.
    events.push({ sec: -1, order: 0, portId: target.portId, kind: 'cc', payload: { controller: 7, value: initialCc7, channel: controlCh }, liveVolume: true });
    events.push({ sec: -1, order: 0, portId: target.portId, kind: 'cc', payload: { controller: 11, value: 127, channel: controlCh } });

    // Preset and sound changes travel as SysEx on the rack's control port,
    // not on the instrument's own port: they are named, not numbered, and no
    // channel-voice message can carry a name. Skipped silently when no
    // control port is present — a rack that has none simply cannot be told.
    if (controlPortId) {
      for (const p of track.patches ?? []) {
        if (p.time < fromBeat) continue;
        let bytes: number[];
        try {
          bytes = encodeControlMessage({
            op: p.kind === 'preset' ? ControlOp.SetPreset : ControlOp.SetSound,
            port: CONTROL_PORT_INDEX,
            channel: target.channel,
            name: p.name,
          });
        } catch (err) {
          console.warn(`[server-middleware] cannot encode ${p.kind} "${p.name}":`, err);
          continue;
        }
        events.push({
          sec: beatsToSeconds(segments, p.time) - skipSec,
          // Ahead of the notes at the same beat: the preset has to be in place
          // before anything is played through it.
          order: -1,
          portId: controlPortId,
          kind: 'sysex',
          payload: { bytes } as never,
        });
      }
    }

    for (const c of track.controls) {
      if (c.time < fromBeat) continue;
      events.push({
        sec: beatsToSeconds(segments, c.time) - skipSec,
        order: 0,
        portId: target.portId,
        kind: 'cc',
        payload: { controller: c.cc & 0x7f, value: c.value & 0x7f, channel: controlCh },
      });
    }

    let allocate: ReturnType<typeof makeMpeAllocator> | undefined;
    if (target.mpe) {
      // One allocator per port: two tracks on the same zone must not collide.
      allocate = mpeAllocators.get(target.portId);
      if (!allocate) mpeAllocators.set(target.portId, (allocate = makeMpeAllocator()));
    }

    for (const n of track.timeline) {
      if (n.time < fromBeat) continue;
      const onSec = beatsToSeconds(segments, n.time) - skipSec;
      const offSec = beatsToSeconds(segments, n.time + n.duration) - skipSec;
      const channel = allocate ? allocate(onSec, offSec) : target.channel;
      if (allocate) markVolumeChannel(target.portId, channel);
      events.push({
        sec: onSec,
        order: 2,
        portId: target.portId,
        kind: 'noteon',
        payload: { note: n.midi, velocity: n.velocity & 0x7f, channel },
      });
      events.push({
        sec: offSec,
        order: 1,
        portId: target.portId,
        kind: 'noteoff',
        payload: { note: n.midi, velocity: 0, channel },
      });
    }
  });

  // MPE zone configuration (RPN 6 = "this many member channels"), once per port.
  for (const portId of zoneInitPorts) {
    for (const [controller, value] of [[101, 0], [100, 6], [6, MPE_MEMBER_CHANNELS.length], [38, 0], [101, 127], [100, 127]]) {
      events.push({ sec: -2, order: 0, portId, kind: 'cc', payload: { controller, value, channel: MPE_MASTER_CH } });
    }
  }

  events.sort((a, b) => a.sec - b.sec || a.order - b.order);

  return {
    key: planKey(opts),
    song,
    segments,
    totalBeats,
    passDurationSec,
    fromBeat,
    device,
    events,
    midiPortIds,
    volumeChannels,
    audioTrackNames,
    rackChannels,
  };
}

/**
 * Compile and render a score, and keep the result standing until something
 * replaces it.
 *
 * The studio calls this whenever the score settles, so the expensive half of
 * playback — decoding the sample libraries and rendering every chunk — happens
 * while the user is still reading, not after they press Play. Repeat calls for
 * a score already prepared are a cache hit and return the same entry, which is
 * what makes it safe for `playOnServer` to simply always await this.
 *
 * Unlike the chunk-at-a-time pump this replaces, the whole pass is rendered up
 * front. That is the point: audio that only exists a chunk ahead of the
 * playhead cannot be handed to a browser in one piece, and cannot start
 * instantly.
 */
export function prepareOnServer(
  opts: {
    code: string;
    device?: string;
    routes?: Record<string, ServerRoute>;
    fromBeat?: number;
  },
  force = false,
): Promise<Prepared> {
  const key = planKey(opts);
  if (!force && prepared && prepared.key === key && prepared.status !== 'error') {
    return prepared.ready;
  }

  let resolveReady!: (entry: Prepared) => void;
  const entry: Prepared = {
    key,
    plan: null,
    status: 'rendering',
    progress: 0,
    error: null,
    audio: null,
    ready: new Promise<Prepared>((resolve) => { resolveReady = resolve; }),
  };
  // Published before the work starts: the chunk loop below checks whether it
  // is still the current entry, and a newer prepare must be able to win.
  prepared = entry;
  broadcast();

  void (async () => {
    try {
      entry.plan = buildPlan(opts);
      if (entry.plan.audioTrackNames.length) {
        if (!(await audioRenderingAvailable())) {
          throw new Error('node-web-audio-api is not available on this server');
        }
        const render = await createChunkedRender(entry.plan.song, {
          onlyTracks: entry.plan.audioTrackNames,
          fromBeat: entry.plan.fromBeat,
        });
        const parts: Float32Array[] = [];
        let total = 0;
        for (let i = 0; i < render.chunkCount; i++) {
          // A newer score has arrived; finishing this one would only burn CPU
          // the render that matters now wants.
          if (prepared !== entry) {
            entry.status = 'error';
            entry.error = 'superseded by a newer render';
            resolveReady(entry);
            return;
          }
          const part = await render.renderChunk(i);
          parts.push(part);
          total += part.length;
          entry.progress = (i + 1) / render.chunkCount;
          broadcast();
        }
        const pcm = new Float32Array(total);
        let at = 0;
        for (const part of parts) {
          pcm.set(part, at);
          at += part.length;
        }
        entry.audio = {
          pcm,
          sampleRate: render.sampleRate,
          channels: 2,
          durationSec: total / 2 / render.sampleRate,
        };
      }
      entry.progress = 1;
      entry.status = 'ready';
    } catch (err) {
      entry.status = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      console.warn('[server-middleware] prepare failed:', err);
    }
    resolveReady(entry);
    broadcast();
  })();

  return entry.ready;
}

/** How long a bridged plugin may take to come up before we stop waiting. */
const WARM_TIMEOUT_MS = 45_000;

/**
 * Switch patches, ask the rack to load what the pass needs, and wait for the
 * readiness reports. Resolves with the channels that never answered.
 *
 * Reports arrive on the status listener the server keeps open; a channel the
 * rack already reported ready is not waited on unless it is being repatched,
 * since a Program Change takes it through `0` on the way to its new `127`.
 */
async function warmRack(output: MidiOutput, channels: Map<number, number | null>): Promise<number[]> {
  const pending = new Set<number>();
  for (const [channel, patch] of channels) {
    if (patch !== null) {
      const [status, program] = patchMessage(channel, patch);
      output.send('program', { number: program, channel: status & 0x0f } as any);
      rackReady.set(channel, false);
    }
    if (rackReady.get(channel) !== true) pending.add(channel);
  }
  for (const channel of pending) {
    const [status, controller, value] = readinessRequest(channel, true);
    output.send('cc', { controller, value, channel: status & 0x0f } as any);
  }
  if (!pending.size) return [];

  warming = [...pending].sort((a, b) => a - b);
  broadcast();
  const started = Date.now();
  try {
    while (pending.size && Date.now() - started < WARM_TIMEOUT_MS) {
      for (const channel of pending) if (rackReady.get(channel)) pending.delete(channel);
      if (pending.size) {
        const next = [...pending].sort((a, b) => a - b);
        if (next.join() !== warming.join()) {
          warming = next;
          broadcast();
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } finally {
    warming = [];
    broadcast();
  }
  return [...pending].sort((a, b) => a - b);
}

/**
 * Start a prepared pass: open the ports, start the clock, hand the finished
 * PCM to the sink. Nothing is compiled or rendered here — the await below is a
 * cache hit in the normal case, and only does real work if someone pressed
 * Play before the studio's own prepare had a chance to run.
 */
export async function playOnServer(opts: {
  code: string;
  device?: string;
  routes?: Record<string, ServerRoute>;
  volume?: number;
  loop?: boolean;
  fromBeat?: number;
  /** Where the rendered audio goes: this machine's sink, or the browser's. */
  speaker?: 'server' | 'client';
}): Promise<void> {
  stopServerPlayback();

  const entry = await prepareOnServer(opts);
  if (entry.status !== 'ready' || !entry.plan) {
    throw new Error(entry.error ?? 'Score could not be prepared');
  }
  const plan = entry.plan;
  const { events, segments, totalBeats, passDurationSec, device } = plan;

  const volume = opts.volume != null ? Math.max(0, Math.min(1, opts.volume)) : state.volume;
  const loop = Boolean(opts.loop);
  const speaker = opts.speaker === 'client' ? 'client' : 'server';

  // ── open the outputs this score actually needs ──
  const outputs = new Map<string, MidiOutput>();
  const openFailures: string[] = [];
  if (plan.midiPortIds.size) {
    if (!easymidi) throw new Error('easymidi package is not available on server');
    const availableOutputs = easymidi.getOutputs();
    for (const portId of plan.midiPortIds) {
      try {
        outputs.set(portId, new easymidi.Output(portId, !availableOutputs.includes(portId)));
      } catch (err) {
        openFailures.push(`${portId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!outputs.size) throw new Error(`Could not open any MIDI output — ${openFailures.join('; ')}`);
  }

  const volumeChannels = plan.volumeChannels;

  // ── get the rack ready ──
  // A lazy rack swallows the notes played while an instrument loads, so the
  // clock does not start until every channel the score uses has answered
  // CC 119 = 127 — or the wait has run out, in which case it starts anyway
  // and says so. Patches go first: a Program Change re-points the channel,
  // and it is the new instrument's readiness that matters.
  const rackId = rackPortId();
  const rackOutput = rackId ? outputs.get(rackId) : undefined;
  if (rackOutput && plan.rackChannels.size) {
    const late = await warmRack(rackOutput, plan.rackChannels);
    if (late.length) {
      state.error = `the rack did not report channel${late.length > 1 ? 's' : ''} ${late.join(', ')} ready in time — playing anyway`;
      broadcast();
    }
  }

  // ── run it ──
  let stopped = false;
  let stepTimer: NodeJS.Timeout | undefined;
  let passTimer: NodeJS.Timeout | undefined;
  let index = 0;
  let passStartMs = Date.now() + LEAD_SEC * 1000;
  const activeNotes = new Set<string>(); // "portId|channel|note"

  const panic = () => {
    for (const [portId, output] of outputs) {
      try {
        for (const key of activeNotes) {
          const [p, ch, note] = key.split('|');
          if (p !== portId) continue;
          output.send('noteoff', { note: Number(note), velocity: 0, channel: Number(ch) } as any);
        }
        // Pedals down, then the blanket kills — see core's midiPanic.
        for (const msg of panicMessages()) {
          output.send('cc', { controller: msg.controller, value: msg.value, channel: msg.channel } as any);
        }
      } catch {}
    }
    activeNotes.clear();
  };

  const closeAll = () => {
    for (const output of outputs.values()) try { output.close(); } catch {}
    outputs.clear();
    audioPlayback?.stop();
    audioPlayback = null;
  };

  /*
   * The rendered audio owns its own looping, so unlike the MIDI stepper it is
   * started once rather than per pass. Both are paced from `passStartMs`, the
   * one wall clock the transport runs on, which is what keeps a score split
   * across the speakers and a rack port in sync.
   *
   * With Speaker set to Client there is nothing to start here: the browser
   * already holds this same PCM (it pulled it from /api/server-audio-buffer
   * when the render went ready) and plays it off its own audio clock.
   */
  let audioPlayback: PcmPlayback | null = null;
  const startAudio = () => {
    if (!entry.audio || speaker === 'client') return;
    audioPlayback = playPcm(
      {
        pcm: entry.audio.pcm,
        sampleRate: entry.audio.sampleRate,
        durationSec: entry.audio.durationSec,
      },
      { volume: state.volume, loop, startAtMs: passStartMs },
    );
  };

  const finishPass = () => {
    if (stopped) return;
    panic();
    if (state.loop) {
      passStartMs += passDurationSec * 1000;
      if (active) active.passStartMs = passStartMs;
      index = 0;
      runPass();
      return;
    }
    stopped = true;
    state.playing = false;
    active = null;
    closeAll();
    broadcast();
  };

  const step = () => {
    if (stopped) return;
    const elapsedMs = Date.now() - passStartMs;
    while (index < events.length && events[index].sec * 1000 <= elapsedMs + 1) {
      const e = events[index++];
      const output = outputs.get(e.portId);
      if (!output) continue;
      try {
        const payload = e.liveVolume
          ? { ...e.payload, value: Math.round(127 * state.volume) }
          : e.payload;
        if (e.kind === 'sysex') output.send('sysex', (payload as any).bytes);
        else output.send(e.kind as any, payload as any);
        const key = `${e.portId}|${e.payload.channel}|${e.payload.note}`;
        if (e.kind === 'noteon') activeNotes.add(key);
        else if (e.kind === 'noteoff') activeNotes.delete(key);
      } catch {}
    }
    if (index >= events.length) return; // finishPass() closes the pass out
    stepTimer = setTimeout(step, Math.max(1, events[index].sec * 1000 - (Date.now() - passStartMs)));
  };

  const runPass = () => {
    step();
    passTimer = setTimeout(finishPass, Math.max(50, passStartMs + passDurationSec * 1000 - Date.now()));
  };

  state.device = device;
  state.volume = volume;
  state.loop = loop;
  state.playing = true;
  state.error = openFailures.length ? `Some outputs failed to open — ${openFailures.join('; ')}` : null;

  active = {
    passStartMs,
    passDurationSec,
    segments,
    totalBeats,
    stop: () => {
      stopped = true;
      if (stepTimer) clearTimeout(stepTimer);
      if (passTimer) clearTimeout(passTimer);
      panic();
      closeAll();
    },
    setVolume: (v: number) => {
      // The render is fixed; volume scales the samples on their way to the
      // sink, so it still takes effect within a chunk (~50 ms).
      audioPlayback?.setVolume(v);
      const value = Math.round(127 * v);
      for (const [portId, channels] of volumeChannels) {
        const output = outputs.get(portId);
        if (!output) continue;
        for (const channel of channels) {
          try { output.send('cc', { controller: 7, value, channel } as any); } catch {}
        }
      }
    },
  };

  startAudio();
  runPass();
  broadcast();
}

/** A single note on a chosen port, for the studio's "Test" button. */
export function sendServerTestNote(device: string, channel: number): void {
  if (device === WEBAUDIO_ID) {
    const doc = parseYaml('tempo: 120\nplay:\n  - "c4"\n');
    void renderSongToPcm(compileDoc(doc)).then((render) =>
      playPcm(render, { volume: state.volume }),
    );
    return;
  }

  if (!easymidi) throw new Error('easymidi package is not available on server');
  const port = getServerPortsInfo().find((p) => p.id === device);
  // On an MPE port a bare note belongs on a member channel, not the master.
  const ch = port?.mpe ? MPE_MEMBER_CHANNELS[0] : (Math.max(1, Math.min(16, channel)) - 1) & 0x0f;
  const output = new easymidi.Output(device, !easymidi.getOutputs().includes(device));
  output.send('noteon', { note: 60, velocity: 100, channel: ch } as any);
  setTimeout(() => {
    try {
      output.send('noteoff', { note: 60, velocity: 0, channel: ch } as any);
      output.close();
    } catch {}
  }, 400);
}

export function setServerVolume(volume: number): void {
  state.volume = Math.max(0, Math.min(1, volume));
  active?.setVolume(state.volume);
  broadcast();
}

// ──────────────────────────────── plugin ────────────────────────────────

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const VPO_MIME: Record<string, string> = {
  '.sfz': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

/**
 * The VPO library, served to the browser one file at a time.
 *
 * The studio's sampler reads the same `.sfz` programs the rack does and
 * fetches each `.wav` the score turns out to need — nothing is bundled, and
 * a score that plays one flute note downloads one flute note. The files
 * never change, so the browser is told to keep them.
 */
function serveVpo(url: string, req: IncomingMessage, res: ServerResponse): void {
  const root = vpoRoot();
  const relative = decodeURIComponent(url.slice('/vpo/'.length));
  const ext = path.extname(relative).toLowerCase();
  if (!VPO_MIME[ext]) {
    res.statusCode = 403;
    return void res.end('forbidden');
  }
  const file = resolveVpoFile(root, relative);
  let stat: fs.Stats | null = null;
  try {
    stat = file ? fs.statSync(file) : null;
  } catch {
    stat = null;
  }
  if (!file || !stat?.isFile()) {
    res.statusCode = 404;
    return void res.end(`not in the VPO library at ${root}`);
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', VPO_MIME[ext]);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (req.method === 'HEAD') return void res.end();
  fs.createReadStream(file).pipe(res);
}

/**
 * The /api/server-* routes, as a plain connect-style handler.
 *
 * Extracted from the Vite plugin so the production server (server.ts) can
 * mount the same routes over the built bundle. The dev plugin below is now
 * just a thin wrapper around it, so there is one implementation, not two.
 */
export async function playYamlApiMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): Promise<void> {
  const url = (req.url || '').split('?')[0];
  if (url.startsWith('/vpo/')) return serveVpo(url, req, res);
  if (!url.startsWith('/api/server-')) return next();

  // The unified stream: one snapshot per event, pushed on every change.
  if (url === '/api/server-events' && req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    // No explicit `Connection` header: it is implicit in HTTP/1.1 and
    // Node warns and drops it.
    res.setHeader('X-Accel-Buffering', 'no'); // don't let a proxy buffer it
    (res as any).flushHeaders?.();
    // Reconnect delay if the dev server restarts under the studio.
    res.write('retry: 1000\n\n');

    clients.add(res);
    send(res, snapshot());
    ensureTicker();

    const drop = () => {
      clients.delete(res);
      stopTickerIfIdle();
    };
    req.on('close', drop);
    req.on('error', drop);
    return;
  }

  /*
   * The standing render, as one downloadable buffer.
   *
   * With Speaker set to Client the browser pulls this as soon as the
   * render goes ready and holds it decoded, so pressing Play starts an
   * AudioBuffer that is already in hand rather than opening a socket and
   * hoping the network keeps up.
   *
   * Interleaved stereo 16-bit at the render's rate, raw — no container,
   * the headers carry what a decoder would otherwise have to be told.
   * Float32 would be truer and twice the bytes, and this is going over a
   * LAN to be listened to, not mastered.
   */
  if (url === '/api/server-audio-buffer' && req.method === 'GET') {
    const entry = prepared;
    if (!entry || entry.status !== 'ready' || !entry.audio) {
      return json(res, { error: 'no prepared audio', status: preparedStatus() }, 409);
    }
    const audio = entry.audio;
    if (!audio.s16) {
      // Encoded once and kept: a reload or a speaker switch asks for the
      // same bytes, and this is the expensive part of serving them.
      const buf = Buffer.allocUnsafe(audio.pcm.length * 2);
      for (let i = 0; i < audio.pcm.length; i++) {
        const v = audio.pcm[i] > 1 ? 1 : audio.pcm[i] < -1 ? -1 : audio.pcm[i];
        buf.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
      }
      audio.s16 = buf;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(audio.s16.length));
    res.setHeader('X-Sample-Rate', String(audio.sampleRate));
    res.setHeader('X-Channels', String(audio.channels));
    res.setHeader('X-Prepared-Key', entry.key);
    res.end(audio.s16);
    return;
  }

  if (url === '/api/server-info' && req.method === 'GET') {
    const snap = snapshot();
    // `portsInfo`/`status` keep the pre-stream shape working for scripts.
    return json(res, { ...snap, portsInfo: snap.ports, status: snap });
  }

  if (url === '/api/server-status' && req.method === 'GET') {
    return json(res, snapshot());
  }

  /*
   * Everything the studio needs to know about the rack in one answer: the
   * channel map, the surfaces, and whether the VPO library is here for the
   * server's own renders. Live readiness is on the stream, not here.
   */
  if (url === '/api/server-rack' && req.method === 'GET') {
    const channels = readRackChannels();
    const surfaces = readSurfaceCatalogue();
    return json(res, {
      available: Boolean(channels.rack),
      error: channels.error || surfaces.error,
      rack: channels.rack,
      catalogue: surfaces.catalogue,
      vpo: { available: fs.existsSync(vpoRoot()), root: vpoRoot() },
    });
  }

  if (url === '/api/server-stop' && req.method === 'POST') {
    stopServerPlayback();
    return json(res, { ok: true, playing: false });
  }

  /*
   * Render now, play later. The studio fires this whenever the score
   * settles; the response says which render is standing so the browser
   * can tell whether the audio it holds is still the right one.
   */
  if (url === '/api/server-prepare' && req.method === 'POST') {
    try {
      const data = await readBody(req);
      const entry = await prepareOnServer(
        {
          code: data.code || '',
          device: data.device,
          routes: data.routes ?? {},
          fromBeat: Number(data.fromBeat) || 0,
        },
        Boolean(data.force),
      );
      return json(res, {
        ok: entry.status === 'ready',
        key: entry.key,
        status: entry.status,
        hasAudio: Boolean(entry.audio),
        durationSec: entry.audio?.durationSec ?? 0,
        error: entry.error,
      });
    } catch (err: any) {
      return json(res, { ok: false, error: err?.message ?? String(err) }, 400);
    }
  }

  if (url === '/api/server-play' && req.method === 'POST') {
    try {
      const data = await readBody(req);
      await playOnServer({
        code: data.code || '',
        device: data.device,
        routes: data.routes ?? {},
        volume: data.volume != null ? Number(data.volume) : undefined,
        loop: Boolean(data.loop),
        fromBeat: Number(data.fromBeat) || 0,
        speaker: data.speaker === 'client' ? 'client' : 'server',
      });
      return json(res, { ok: true, playing: true, device: state.device });
    } catch (err: any) {
      state.error = err?.message ?? String(err);
      broadcast();
      return json(res, { ok: false, error: state.error }, 400);
    }
  }

  if (url === '/api/server-volume' && req.method === 'POST') {
    try {
      const data = await readBody(req);
      setServerVolume(Number(data.volume));
      return json(res, { ok: true, volume: state.volume });
    } catch (err: any) {
      return json(res, { ok: false, error: err?.message ?? String(err) }, 400);
    }
  }

  if (url === '/api/server-test-note' && req.method === 'POST') {
    try {
      const data = await readBody(req);
      sendServerTestNote(String(data.device || WEBAUDIO_ID), Number(data.channel) || 1);
      return json(res, { ok: true });
    } catch (err: any) {
      return json(res, { ok: false, error: err?.message ?? String(err) }, 400);
    }
  }

  return next();
}

/** Tear down playback and drop every SSE client. */
export function shutdownServerPlayback(): void {
  stopServerPlayback();
  if (statusInput) {
    try { statusInput.close(); } catch {}
    statusInput = null;
  }
  for (const res of clients) try { res.end(); } catch {}
  clients.clear();
  stopTickerIfIdle();
}

export function playYamlServerPlugin(): Plugin {
  return {
    name: 'play-yaml-server-middleware',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(playYamlApiMiddleware);
      server.httpServer?.on('close', shutdownServerPlayback);
    },
  };
}
