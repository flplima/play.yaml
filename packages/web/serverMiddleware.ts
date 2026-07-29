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
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseYaml,
  compileDoc,
  tempoSegments,
  beatsToSeconds,
  secondsToBeats,
  songEndBeat,
  panicMessages,
  // Straight from core's source, not its dist: vite bundles this config file
  // with esbuild, so a relative import is inlined and core edits take effect
  // without a `npm run build -w core` first (the same deal the app's alias
  // gives src/). Importing '@play.yaml/core' here would silently pin the
  // engine to a stale dist.
} from '../core/src/index';
import type { CompiledSong } from '../core/src/index';
import {
  audioRenderingAvailable, createChunkedRender, playChunks, playPcm, renderSongToPcm,
  type ChunkedRender, type PcmPlayback,
} from '@play.yaml/node-audio';
import type { TempoSegment } from '../core/src/time';

// Both are CommonJS: importing them from ESM lands the real module object on
// `.default` at runtime even though the types describe the namespace.
type EasyMidi = typeof import('easymidi');
type MidiOutput = InstanceType<EasyMidi['Output']>;

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

export interface ConfigPort {
  name?: string;
  mpe?: boolean;
  channels?: Record<string | number, string>;
}

export interface ServerPortInfo {
  id: string;
  name: string;
  rawName: string;
  mpe: boolean;
  channels: Record<number, string>;
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
  error: string | null;
}

// ─────────────────────────────── config.yaml ───────────────────────────────

function readConfigYaml(): Record<string, ConfigPort> {
  const configPaths = [
    path.resolve(process.cwd(), 'config.yaml'),
    path.resolve(process.cwd(), '../config.yaml'),
    path.resolve(process.cwd(), '../../config.yaml'),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const parsed = parseYaml(fs.readFileSync(configPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.ports && typeof parsed.ports === 'object') {
          const cleanedPorts: Record<string, ConfigPort> = {};
          for (const [key, conf] of Object.entries(parsed.ports as Record<string, ConfigPort>)) {
            cleanedPorts[key.replace(/^["']|["']$/g, '').trim()] = conf;
          }
          return cleanedPorts;
        }
      } catch (err) {
        console.warn(`[server-middleware] Error parsing ${configPath}:`, err);
      }
    }
  }
  return {};
}

// Scanning ALSA on every stream tick would be wasteful; the device list only
// changes when someone plugs something in.
let portsCache: { at: number; ports: ServerPortInfo[] } | null = null;
const PORTS_TTL_MS = 2000;

export function getServerPortsInfo(force = false): ServerPortInfo[] {
  if (!force && portsCache && Date.now() - portsCache.at < PORTS_TTL_MS) return portsCache.ports;

  const configPorts = readConfigYaml();
  const result: ServerPortInfo[] = [
    { id: WEBAUDIO_ID, name: WEBAUDIO_ID, rawName: WEBAUDIO_ID, mpe: false, channels: {} },
  ];

  try {
    const outputs = easymidi?.getOutputs?.() ?? [];
    for (const rawOutput of outputs) {
      // config.yaml keys the friendly names off the stable part of the ALSA
      // string ("Midi Through Port-0"), not the whole "client:port 14:0" form.
      let matchedConfig: ConfigPort | undefined;
      let matchedKey = rawOutput;
      for (const [key, conf] of Object.entries(configPorts)) {
        if (rawOutput.includes(key) || key.includes(rawOutput)) {
          matchedConfig = conf;
          matchedKey = key;
          break;
        }
      }

      const channelsMap: Record<number, string> = {};
      for (const [ch, name] of Object.entries(matchedConfig?.channels ?? {})) {
        channelsMap[Number(ch)] = String(name);
      }

      result.push({
        id: rawOutput,
        name: matchedConfig?.name || rawOutput,
        rawName: matchedKey,
        mpe: Boolean(matchedConfig?.mpe),
        channels: channelsMap,
      });
    }
  } catch (err) {
    console.warn('[server-middleware] Error building server ports info:', err);
  }

  portsCache = { at: Date.now(), ports: result };
  return result;
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
  kind: 'noteon' | 'noteoff' | 'cc';
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

export async function playOnServer(opts: {
  code: string;
  device?: string;
  routes?: Record<string, ServerRoute>;
  volume?: number;
  loop?: boolean;
  fromBeat?: number;
}): Promise<void> {
  stopServerPlayback();

  const doc = parseYaml(opts.code);
  if (!doc || typeof doc !== 'object' || (doc.play == null && doc.tracks == null)) {
    throw new Error('Invalid score: missing play or tracks definition');
  }
  const song = compileDoc(doc);

  const ports = getServerPortsInfo(true);
  const device = opts.device || WEBAUDIO_ID;
  const routes = opts.routes ?? {};
  const volume = opts.volume != null ? Math.max(0, Math.min(1, opts.volume)) : state.volume;
  const loop = Boolean(opts.loop);
  const fromBeat = opts.fromBeat ?? 0;

  const targets = resolveTargets(song, routes, device, ports);
  const segments = tempoSegments(song.bpm || 120, song.tempoMap);
  const totalBeats = songEndBeat(song);
  const skipSec = beatsToSeconds(segments, fromBeat);
  const passDurationSec =
    Math.max(0, beatsToSeconds(segments, totalBeats) - skipSec) + TAIL_SEC;

  // ── open the outputs this score actually needs ──
  const midiPortIds = new Set(
    targets.filter((t) => t.portId !== WEBAUDIO_ID).map((t) => t.portId),
  );
  const outputs = new Map<string, MidiOutput>();
  const openFailures: string[] = [];

  if (midiPortIds.size) {
    if (!easymidi) throw new Error('easymidi package is not available on server');
    const availableOutputs = easymidi.getOutputs();
    for (const portId of midiPortIds) {
      try {
        outputs.set(portId, new easymidi.Output(portId, !availableOutputs.includes(portId)));
      } catch (err) {
        openFailures.push(`${portId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!outputs.size) throw new Error(`Could not open any MIDI output — ${openFailures.join('; ')}`);
  }

  // Tracks routed to the server's own speakers are rendered to PCM up front
  // and streamed to an audio sink; see serverAudio.ts for why there is no
  // realtime Web Audio context here any more.
  const audioTrackNames = song.tracks
    .filter((_, i) => targets[i].portId === WEBAUDIO_ID)
    .map((t) => t.name);
  let audioRender: ChunkedRender | null = null;
  if (audioTrackNames.length) {
    if (!(await audioRenderingAvailable())) {
      for (const out of outputs.values()) try { out.close(); } catch {}
      throw new Error('node-web-audio-api is not available on this server');
    }
    // Only decodes the sample libraries and sizes the chunks; the audio itself
    // is rendered a chunk ahead of playback, so this returns quickly even for
    // a long score.
    audioRender = await createChunkedRender(song, { onlyTracks: audioTrackNames, fromBeat });
  }

  // ── build one pass of MIDI events, in seconds from the top of the pass ──
  const initialCc7 = Math.round(127 * volume);
  const events: MidiEvent[] = [];
  const mpeAllocators = new Map<string, ReturnType<typeof makeMpeAllocator>>();
  const zoneInitPorts = new Set<string>();
  // Which (port, channel) pairs are live, so a volume move can reach them.
  const volumeChannels = new Map<string, Set<number>>();

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

    // CC7 carries the master volume. Everything else — expression, pedal,
    // playmode, bow pressure — is the composer's data and is sent verbatim.
    events.push({ sec: -1, order: 0, portId: target.portId, kind: 'cc', payload: { controller: 7, value: initialCc7, channel: controlCh }, liveVolume: true });
    events.push({ sec: -1, order: 0, portId: target.portId, kind: 'cc', payload: { controller: 11, value: 127, channel: controlCh } });

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
   */
  let audioPlayback: PcmPlayback | null = null;
  const startAudio = () => {
    if (!audioRender) return;
    audioPlayback = playChunks(audioRender, {
      volume: state.volume,
      loop,
      startAtMs: passStartMs,
    });
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
        output.send(e.kind as any, payload as any);
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

export function playYamlServerPlugin(): Plugin {
  return {
    name: 'play-yaml-server-middleware',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
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

        if (url === '/api/server-info' && req.method === 'GET') {
          const snap = snapshot();
          // `portsInfo`/`status` keep the pre-stream shape working for scripts.
          return json(res, { ...snap, portsInfo: snap.ports, status: snap });
        }

        if (url === '/api/server-status' && req.method === 'GET') {
          return json(res, snapshot());
        }

        if (url === '/api/server-stop' && req.method === 'POST') {
          stopServerPlayback();
          return json(res, { ok: true, playing: false });
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
      });

      server.httpServer?.on('close', () => {
        stopServerPlayback();
        for (const res of clients) try { res.end(); } catch {}
        clients.clear();
        stopTickerIfIdle();
      });
    },
  };
}
