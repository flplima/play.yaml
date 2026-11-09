/**
 * sfzSampler.ts — playing an SFZ instrument through Web Audio.
 *
 * The regions come from sfz.ts; this decides which of them a note reaches
 * for and turns each into a voice: a buffer source at the right pitch, an
 * amplitude envelope, the static trims the region asks for, and whatever the
 * control stream does to it while it sounds. It runs on any BaseAudioContext
 * — the browser's live transport, its offline MP3 render, and the CLI's
 * node-web-audio-api render all share it — and it honours the opcodes the
 * Virtual Playing Orchestra actually uses rather than the whole SFZ spec:
 *
 *   keys/velocities/round-robins/keyswitches to pick a region; `volume`,
 *   `pan`, `tune`, `transpose`, `pitch_random`, `amp_random`, `offset`,
 *   `delay`; the `ampeg_*` envelope with its velocity and controller
 *   modifiers; `amp_veltrack`; key and velocity crossfades; controller
 *   crossfades and `gain_ccN`; `loop_mode`, with loop points read from the
 *   sample's own `smpl` chunk; `group`/`off_by` voice stealing; and
 *   `trigger=release` samples.
 *
 * Controllers reach a voice two ways. At note-on the bus says what every CC
 * holds; after that, a change is either already in the bus's history (an
 * offline render applies the whole stream before it schedules a note) or
 * arrives through the bus's listener (live playback applies each as the
 * transport reaches it). Both feed the same per-voice modulation, so a
 * crescendo on the mod wheel crossfades a brass layer identically whether it
 * is rendered ahead or played now.
 *
 * Samples are fetched on demand: `prepare` is told which notes are coming and
 * loads only the regions they will play, and a region whose sample is not in
 * memory when its note arrives stays silent rather than late.
 */

import { glideParam, type TrackBus } from './bus';
import { CC } from './vocabulary';
import { parseSfz, sfzKey, sfzNumber, type SfzInstrument, type SfzOpcodes, type SfzReader } from './sfz';

// ---------------------------------------------------------------------------
// Regions, typed
// ---------------------------------------------------------------------------

/** A per-controller modulation: `cc` → the opcode's value at CC = 127. */
interface CcMod {
  cc: number;
  value: number;
}

interface CcCrossfade {
  cc: number;
  lo: number;
  hi: number;
  /** `in` rises from lo to hi, `out` falls. */
  direction: 'in' | 'out';
}

export interface Region {
  sample: string;
  lokey: number;
  hikey: number;
  keycenter: number;
  lovel: number;
  hivel: number;
  seqLength: number;
  seqPosition: number;
  /** Keyswitch this region needs to have been the last one pressed, if any. */
  swLast?: number;
  swDefault?: number;
  releaseTrigger: boolean;
  loopMode: 'no_loop' | 'one_shot' | 'loop_continuous' | 'auto';
  /** Seconds into the sample to start, from `offset` (in frames). */
  offsetFrames: number;
  delay: number;
  /** dB. */
  volume: number;
  /** -100 … 100. */
  pan: number;
  /** Cents, including `transpose`. */
  tune: number;
  pitchRandom: number;
  ampRandom: number;
  ampVeltrack: number;
  attack: number;
  hold: number;
  decay: number;
  /** 0 … 1. */
  sustain: number;
  release: number;
  vel2attack: number;
  vel2decay: number;
  vel2release: number;
  attackCc: CcMod[];
  gainCc: CcMod[];
  ccCrossfades: CcCrossfade[];
  ccCurve: 'gain' | 'power';
  xfinLokey?: number; xfinHikey?: number; xfoutLokey?: number; xfoutHikey?: number;
  xfinLovel?: number; xfinHivel?: number; xfoutLovel?: number; xfoutHivel?: number;
  keyCurve: 'gain' | 'power';
  velCurve: 'gain' | 'power';
  group: number;
  offBy: number;
}

/** Controller values a program sets on load (`set_ccN` in `<control>`). */
export type CcDefaults = Map<number, number>;

function ccMods(op: SfzOpcodes, prefix: string): CcMod[] {
  const out: CcMod[] = [];
  for (const key of Object.keys(op)) {
    const m = new RegExp(`^${prefix}cc(\\d+)$`).exec(key);
    if (m) out.push({ cc: parseInt(m[1], 10), value: sfzNumber(op[key], 0) });
  }
  return out;
}

function ccCrossfades(op: SfzOpcodes): CcCrossfade[] {
  const out: CcCrossfade[] = [];
  for (const direction of ['in', 'out'] as const) {
    for (const key of Object.keys(op)) {
      const m = new RegExp(`^xf${direction}_locc(\\d+)$`).exec(key);
      if (!m) continue;
      const cc = parseInt(m[1], 10);
      const lo = sfzNumber(op[key], 0);
      const hi = sfzNumber(op[`xf${direction}_hicc${cc}`], lo);
      out.push({ cc, lo, hi, direction });
    }
  }
  return out;
}

function typedRegion(sample: string, op: SfzOpcodes): Region {
  const key = sfzKey(op.key);
  const loopMode = op.loop_mode as Region['loopMode'] | undefined;
  return {
    sample,
    lokey: sfzKey(op.lokey) ?? key ?? 0,
    hikey: sfzKey(op.hikey) ?? key ?? 127,
    keycenter: sfzKey(op.pitch_keycenter) ?? key ?? 60,
    lovel: sfzNumber(op.lovel, 0),
    hivel: sfzNumber(op.hivel, 127),
    seqLength: Math.max(1, Math.round(sfzNumber(op.seq_length, 1))),
    seqPosition: Math.max(1, Math.round(sfzNumber(op.seq_position, 1))),
    swLast: sfzKey(op.sw_last),
    swDefault: sfzKey(op.sw_default),
    releaseTrigger: op.trigger === 'release',
    loopMode: loopMode === 'one_shot' || loopMode === 'loop_continuous' || loopMode === 'no_loop' ? loopMode : 'auto',
    offsetFrames: Math.max(0, sfzNumber(op.offset, 0)),
    delay: Math.max(0, sfzNumber(op.delay, 0)),
    volume: sfzNumber(op.volume, 0),
    pan: sfzNumber(op.pan, 0),
    tune: sfzNumber(op.tune, 0) + sfzNumber(op.transpose, 0) * 100,
    pitchRandom: sfzNumber(op.pitch_random, 0),
    ampRandom: sfzNumber(op.amp_random, 0),
    ampVeltrack: sfzNumber(op.amp_veltrack, 100),
    attack: sfzNumber(op.ampeg_attack, 0),
    hold: sfzNumber(op.ampeg_hold, 0),
    decay: sfzNumber(op.ampeg_decay, 0),
    sustain: Math.max(0, Math.min(100, sfzNumber(op.ampeg_sustain, 100))) / 100,
    release: sfzNumber(op.ampeg_release, 0),
    vel2attack: sfzNumber(op.ampeg_vel2attack, 0),
    vel2decay: sfzNumber(op.ampeg_vel2decay, 0),
    vel2release: sfzNumber(op.ampeg_vel2release, 0),
    attackCc: ccMods(op, 'ampeg_attack'),
    gainCc: ccMods(op, 'gain_'),
    ccCrossfades: ccCrossfades(op),
    ccCurve: op.xf_cccurve === 'gain' ? 'gain' : 'power',
    xfinLokey: sfzKey(op.xfin_lokey), xfinHikey: sfzKey(op.xfin_hikey),
    xfoutLokey: sfzKey(op.xfout_lokey), xfoutHikey: sfzKey(op.xfout_hikey),
    xfinLovel: op.xfin_lovel === undefined ? undefined : sfzNumber(op.xfin_lovel, 0),
    xfinHivel: op.xfin_hivel === undefined ? undefined : sfzNumber(op.xfin_hivel, 127),
    xfoutLovel: op.xfout_lovel === undefined ? undefined : sfzNumber(op.xfout_lovel, 0),
    xfoutHivel: op.xfout_hivel === undefined ? undefined : sfzNumber(op.xfout_hivel, 127),
    keyCurve: op.xf_keycurve === 'gain' ? 'gain' : 'power',
    velCurve: op.xf_velcurve === 'gain' ? 'gain' : 'power',
    group: sfzNumber(op.group, 0),
    // `offby` is a typo two of the library's files carry; honouring it is
    // cheaper than a silent open triangle.
    offBy: sfzNumber(op.off_by ?? op.offby, 0),
  };
}

// ---------------------------------------------------------------------------
// The sample's own loop points
// ---------------------------------------------------------------------------

/**
 * Loop points from a WAV's `smpl` chunk, in seconds of the file's own rate.
 *
 * The library keeps its loops in the files rather than in the `.sfz`
 * (`loop_start`/`loop_end` appear nowhere in it), and `decodeAudioData`
 * throws that chunk away — so it is read here, off the bytes, before the
 * decoder gets them. `end` is inclusive in the chunk and exclusive here.
 */
function wavLoopPoints(bytes: ArrayBuffer): { start: number; end: number } | null {
  const view = new DataView(bytes);
  if (bytes.byteLength < 12) return null;
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let rate = 0;
  let loop: { start: number; end: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && body + 8 <= bytes.byteLength) rate = view.getUint32(body + 4, true);
    if (id === 'smpl' && body + 36 <= bytes.byteLength) {
      const loops = view.getUint32(body + 28, true);
      if (loops > 0 && body + 36 + 24 <= bytes.byteLength) {
        loop = { start: view.getUint32(body + 36 + 8, true), end: view.getUint32(body + 36 + 12, true) + 1 };
      }
    }
    at = body + size + (size & 1);
  }
  if (!loop || !rate) return null;
  return { start: loop.start / rate, end: loop.end / rate };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** How a backend gets at the library: text for `.sfz`, bytes for samples. */
export interface SfzAssets {
  text: (path: string) => Promise<string>;
  audio: (path: string) => Promise<ArrayBuffer>;
}

interface Sample {
  buffer: AudioBuffer;
  loop: { start: number; end: number } | null;
}

/**
 * Decoded samples, shared by every program and every render in a process:
 * a buffer is not bound to the context that decoded it.
 */
const samples = new Map<string, Promise<Sample | null>>();

function loadSample(ctx: BaseAudioContext, assets: SfzAssets, path: string): Promise<Sample | null> {
  let promise = samples.get(path);
  if (!promise) {
    promise = assets.audio(path)
      .then(async (bytes) => {
        const loop = wavLoopPoints(bytes);
        // decodeAudioData detaches the buffer, so the loop is read first.
        const buffer = await ctx.decodeAudioData(bytes);
        return { buffer, loop };
      })
      .catch((err) => {
        // One bad file must not silence the instrument — its region just
        // never sounds — but a transient failure gets another chance.
        console.warn(`sfz: could not load ${path}:`, err);
        samples.delete(path);
        return null;
      });
    samples.set(path, promise);
  }
  return promise;
}

/** What a note needs to know to pick its regions, before it is played. */
export interface NoteRequest {
  midi: number;
  velocity: number;
}

/** A parsed program: its regions and controller defaults, samples pending. */
export class SfzProgram {
  readonly regions: Region[];
  readonly ccDefaults: CcDefaults;
  private readonly loaded = new Map<string, Sample>();
  private readonly seq = new Map<string, number>();

  constructor(
    readonly path: string,
    instrument: SfzInstrument,
    private readonly ctx: BaseAudioContext,
    private readonly assets: SfzAssets,
  ) {
    this.regions = instrument.regions.map((r) => typedRegion(r.sample, r.opcodes));
    this.ccDefaults = new Map();
    for (const key of Object.keys(instrument.control)) {
      const m = /^set_cc(\d+)$/.exec(key);
      if (m) this.ccDefaults.set(parseInt(m[1], 10), sfzNumber(instrument.control[key], 0));
    }
  }

  static async load(ctx: BaseAudioContext, assets: SfzAssets, path: string): Promise<SfzProgram> {
    const read: SfzReader = (file) => assets.text(file);
    return new SfzProgram(path, await parseSfz(path, read), ctx, assets);
  }

  /** Regions a note-on (or, with `release`, a note-off) at this key reaches. */
  candidates(midi: number, velocity: number, release = false): Region[] {
    return this.regions.filter((r) => r.releaseTrigger === release && reaches(r, midi, velocity));
  }

  /** Fetch every sample these notes could reach, ahead of playing them. */
  async prepare(notes: Iterable<NoteRequest>): Promise<void> {
    const wanted = new Set<string>();
    for (const note of notes) {
      for (const region of this.regions) {
        if (reaches(region, note.midi, note.velocity)) wanted.add(region.sample);
      }
    }
    await Promise.all([...wanted].filter((path) => !this.loaded.has(path)).map(async (path) => {
      const sample = await loadSample(this.ctx, this.assets, path);
      if (sample) this.loaded.set(path, sample);
    }));
  }

  sample(region: Region): Sample | undefined {
    const sample = this.loaded.get(region.sample);
    if (!sample) void loadSample(this.ctx, this.assets, region.sample).then((s) => {
      if (s) this.loaded.set(region.sample, s);
    });
    return sample;
  }

  /** Round-robin: is it this region's turn in its sequence for a fresh note at this key? */
  advance(region: Region, midi: number): boolean {
    if (region.seqLength <= 1) return true;
    const count = this.seq.get(sequenceKey(region, midi)) ?? 0;
    return (count % region.seqLength) + 1 === region.seqPosition;
  }

  bump(midi: number, regions: Region[]): void {
    const seen = new Set<string>();
    for (const region of regions) {
      if (region.seqLength <= 1) continue;
      const key = sequenceKey(region, midi);
      if (seen.has(key)) continue;
      seen.add(key);
      this.seq.set(key, (this.seq.get(key) ?? 0) + 1);
    }
  }
}

/** Does a note at this key and velocity fall in the region (keyswitch at its default)? */
function reaches(r: Region, midi: number, velocity: number): boolean {
  return midi >= r.lokey && midi <= r.hikey &&
    velocity >= r.lovel && velocity <= r.hivel &&
    (r.swLast === undefined || r.swLast === r.swDefault);
}

/** Round-robin regions share a sequence per key/velocity zone. */
function sequenceKey(r: Region, midi: number): string {
  return `${midi}:${r.lokey}-${r.hikey}:${r.lovel}-${r.hivel}`;
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

const dB = (value: number) => Math.pow(10, value / 20);

/** Position of `x` in [lo, hi], 0 below and 1 above. */
function ramp(x: number, lo: number, hi: number): number {
  if (hi <= lo) return x >= hi ? 1 : 0;
  return Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
}

/** A crossfade's amplitude for a position along it. */
function fade(position: number, curve: 'gain' | 'power'): number {
  return curve === 'gain' ? position : Math.sin((position * Math.PI) / 2);
}

/** The level the controllers currently give a region, as an amplitude. */
function controllerGain(region: Region, ccAt: (cc: number) => number): number {
  let gain = 1;
  for (const mod of region.gainCc) gain *= dB((mod.value * ccAt(mod.cc)) / 127);
  for (const xf of region.ccCrossfades) {
    const position = ramp(ccAt(xf.cc), xf.lo, xf.hi);
    gain *= fade(xf.direction === 'in' ? position : 1 - position, region.ccCurve);
  }
  return gain;
}

/** Static trims decided at note-on: key and velocity crossfades, velocity tracking. */
function staticGain(region: Region, midi: number, velocity: number, flattenVelocity: boolean): number {
  let gain = dB(region.volume);
  if (region.ampRandom) gain *= dB((Math.random() * 2 - 1) * region.ampRandom);

  // Velocity: SFZ's default curve is the square, scaled by how much of the
  // level velocity is allowed to own. With an expression stream on the bus
  // the loudness is already the score's, so velocity only shades the attack.
  const track = region.ampVeltrack / 100;
  const curve = Math.pow(velocity / 127, 2);
  const shaped = flattenVelocity ? 0.35 + 0.65 * curve : curve;
  gain *= (1 - track) + track * shaped;

  if (region.xfinLokey !== undefined && region.xfinHikey !== undefined) {
    gain *= fade(ramp(midi, region.xfinLokey, region.xfinHikey + 1), region.keyCurve);
  }
  if (region.xfoutLokey !== undefined && region.xfoutHikey !== undefined) {
    gain *= fade(1 - ramp(midi, region.xfoutLokey, region.xfoutHikey + 1), region.keyCurve);
  }
  if (region.xfinLovel !== undefined && region.xfinHivel !== undefined) {
    gain *= fade(ramp(velocity, region.xfinLovel, region.xfinHivel), region.velCurve);
  }
  if (region.xfoutLovel !== undefined && region.xfoutHivel !== undefined) {
    gain *= fade(1 - ramp(velocity, region.xfoutLovel, region.xfoutHivel), region.velCurve);
  }
  return gain;
}

interface Voice {
  region: Region;
  source: AudioBufferSourceNode;
  envelope: GainNode;
  /** Level from the controllers — modulated while the note sounds. */
  modulation: GainNode;
  /** Move the controller level to `gain` at `time`. */
  modulate: (gain: number, time: number) => void;
  /** Release the note (unless the pedal holds it) at this context time. */
  release: (time: number) => void;
  /** Stop outright — a voice in a group another one turns off. */
  choke: (time: number) => void;
  /** The controller value in force at `time`, as this voice's program reads it. */
  ccAt: (cc: number, time: number) => number;
  released: boolean;
  /** Voices sound on a bus; the set is per bus so pedals and groups scope right. */
  bus: TrackBus;
}

/** A pedal is down from the top of the range's lower half. */
const PEDAL_DOWN = 64;

/** Per-bus voice bookkeeping: what sounds, what the pedal holds, what a CC moves. */
class BusVoices {
  readonly voices = new Set<Voice>();
  /** Notes whose note-off came while the pedal was down. */
  readonly held = new Set<Voice>();
  constructor(readonly bus: TrackBus) {
    // The bus's own dispose() drops this listener with the rest.
    bus.onCC((cc, value, time) => {
      // Live changes reach the voices that are sounding now; an offline
      // render already scheduled them from the history at note-on.
      for (const voice of this.voices) applyControllerAt(voice, cc, value, time);
      if (cc === CC.sustain && value < PEDAL_DOWN) {
        for (const voice of this.held) voice.release(time);
        this.held.clear();
      }
    });
  }
}

const busVoices = new WeakMap<TrackBus, BusVoices>();

function voicesOf(bus: TrackBus): BusVoices {
  let entry = busVoices.get(bus);
  if (!entry) {
    entry = new BusVoices(bus);
    busVoices.set(bus, entry);
  }
  return entry;
}

function applyControllerAt(voice: Voice, cc: number, value: number, time: number): void {
  const region = voice.region;
  if (!region.gainCc.some((m) => m.cc === cc) && !region.ccCrossfades.some((x) => x.cc === cc)) return;
  voice.modulate(controllerGain(region, (n) => (n === cc ? value : voice.ccAt(n, time))), time);
}

/**
 * Everything the caller has to say about a note, resolved by the instrument
 * wrapper: which program to reach into, and how the bus is set.
 */
export interface VoiceOptions {
  program: SfzProgram;
  bus: TrackBus;
  midi: number;
  velocity: number;
  /** Context time of the note-on. */
  start: number;
  /** Context time of the note-off; Infinity for a one-shot with no length. */
  end: number;
  /** Whether the bus carries an expression stream (velocity shades, not levels). */
  flattenVelocity: boolean;
  /** A level trim for the whole program, as an amplitude. */
  trim?: number;
}

/**
 * Start every region a note reaches, with its release and any release
 * samples scheduled. Returns the number of voices started, so a caller can
 * fall back to something else for a key the program does not cover.
 */
export function startNote(opts: VoiceOptions): number {
  const { program, bus, midi, velocity, start, end } = opts;
  const ctx = bus.ctx;
  const candidates = program.candidates(midi, velocity).filter((r) => program.advance(r, midi));
  program.bump(midi, program.candidates(midi, velocity));
  if (!candidates.length) return 0;

  const registry = voicesOf(bus);
  // Offline and live paths read the same defaults: the bus's history, then
  // the program's own `set_ccN`.
  const ccAt = (cc: number, time: number) => bus.ccAt(cc, time) ?? program.ccDefaults.get(cc) ?? 0;
  const ccNow = (cc: number) => ccAt(cc, start);
  let started = 0;

  for (const region of candidates) {
    const sample = program.sample(region);
    if (!sample) continue;

    // Exclusive groups: a hit in group G silences whatever is turned off by G.
    if (region.group) {
      for (const other of registry.voices) {
        if (other.region.offBy === region.group) other.choke(start);
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    const cents = (midi - region.keycenter) * 100 + region.tune
      + (region.pitchRandom ? (Math.random() * 2 - 1) * region.pitchRandom : 0);
    const rate = Math.pow(2, cents / 1200);
    source.playbackRate.value = rate;

    // The track's vibrato LFO, in cents, into the note's pitch. Some contexts
    // (Tone's live shim) have no detune on a buffer source; cents then go
    // through playbackRate, 1 cent ≈ rate·ln2/1200.
    let vibratoSink: AudioParam | GainNode | null = null;
    if (source.detune) {
      vibratoSink = source.detune;
      bus.vibrato.connect(source.detune);
    } else {
      const centsToRate = ctx.createGain();
      centsToRate.gain.value = (rate * Math.LN2) / 1200;
      bus.vibrato.connect(centsToRate);
      centsToRate.connect(source.playbackRate);
      vibratoSink = centsToRate;
    }

    const loopMode = region.loopMode === 'auto' ? (sample.loop ? 'loop_continuous' : 'no_loop') : region.loopMode;
    if (loopMode === 'loop_continuous' && sample.loop && sample.loop.end > sample.loop.start) {
      source.loop = true;
      source.loopStart = sample.loop.start;
      source.loopEnd = Math.min(sample.loop.end, sample.buffer.duration);
    }

    // Envelope: attack (plus its velocity and controller modifiers), hold,
    // decay to sustain, then release at note-off.
    let attack = region.attack + (region.vel2attack * velocity) / 127;
    for (const mod of region.attackCc) attack += (mod.value * ccNow(mod.cc)) / 127;
    attack = Math.max(0.001, attack);
    const decay = Math.max(0, region.decay + (region.vel2decay * velocity) / 127);
    const release = Math.max(0.005, region.release + (region.vel2release * velocity) / 127);
    const level = staticGain(region, midi, velocity, opts.flattenVelocity) * (opts.trim ?? 1);

    const at = start + region.delay;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + attack);
    const holdEnd = at + attack + region.hold;
    if (region.sustain < 1 && decay > 0) {
      envelope.gain.setValueAtTime(level, holdEnd);
      envelope.gain.setTargetAtTime(level * region.sustain, holdEnd, decay / 3);
    } else if (region.sustain < 1) {
      envelope.gain.setValueAtTime(level * region.sustain, holdEnd);
    }

    const modulation = ctx.createGain();
    let modulated = controllerGain(region, ccNow);
    modulation.gain.value = modulated;
    // Anchored at the value last scheduled here, not `param.value`: in an
    // offline render every move is scheduled before anything has played.
    const modulate = (gain: number, time: number) => {
      glideParam(modulation.gain, gain, time, 0.02, modulated);
      modulated = gain;
    };
    const horizon = end === Infinity ? at + sample.buffer.duration : end + release + 1;
    const moves: Array<[number, number]> = [];
    for (const mod of [...region.gainCc, ...region.ccCrossfades]) {
      for (const [time] of bus.ccChanges(mod.cc, start, horizon)) moves.push([time, mod.cc]);
    }
    for (const [time] of moves.sort((a, b) => a[0] - b[0])) {
      modulate(controllerGain(region, (n) => ccAt(n, time)), time);
    }

    /**
     * Where the envelope stands at `time`, worked out rather than read: an
     * offline render schedules the release before a sample has played, and
     * the parameter's value then says nothing about the curve.
     */
    const envelopeAt = (time: number): number => {
      if (time <= at) return 0;
      if (time < at + attack) return (level * (time - at)) / attack;
      if (time < holdEnd || region.sustain >= 1) return level;
      if (decay <= 0) return level * region.sustain;
      const floor = level * region.sustain;
      return floor + (level - floor) * Math.exp(-(time - holdEnd) / (decay / 3));
    };

    let tail: AudioNode = modulation;
    source.connect(envelope);
    envelope.connect(modulation);
    if (region.pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, region.pan / 100));
      modulation.connect(panner);
      tail = panner;
    }
    tail.connect(bus.input);

    const offset = sample.buffer.sampleRate ? region.offsetFrames / sample.buffer.sampleRate : 0;
    source.start(at, Math.min(offset, Math.max(0, sample.buffer.duration - 0.01)));

    const voice: Voice = {
      region, source, envelope, modulation, modulate, bus, ccAt, released: false,
      release: (time: number) => {
        if (voice.released) return;
        voice.released = true;
        glideParam(envelope.gain, 0, time, release / 4, envelopeAt(time));
        try {
          source.stop(time + release + 0.05);
        } catch {
          // Already stopped.
        }
      },
      choke: (time: number) => {
        if (voice.released) return;
        voice.released = true;
        glideParam(envelope.gain, 0, time, 0.008, envelopeAt(time));
        try {
          source.stop(time + 0.05);
        } catch {
          // Already stopped.
        }
      },
    };
    registry.voices.add(voice);
    source.onended = () => {
      registry.voices.delete(voice);
      registry.held.delete(voice);
      try {
        if (vibratoSink) bus.vibrato.disconnect(vibratoSink as AudioParam);
      } catch {
        // Bus already disposed.
      }
      tail.disconnect();
      modulation.disconnect();
      envelope.disconnect();
    };

    if (loopMode === 'one_shot' || end === Infinity) {
      // Plays out as recorded; nothing to release.
      try {
        source.stop(at + sample.buffer.duration / rate + 0.05);
      } catch {
        // Already stopped.
      }
    } else {
      scheduleRelease(voice, bus, end);
    }
    started++;
  }

  // Release samples (a bow leaving the string, a timpani mallet) start at
  // the note-off, at the note-on's velocity.
  const releaseAt = end === Infinity ? Infinity : (pedalHoldsUntil(bus, end) ?? end);
  if (Number.isFinite(releaseAt)) {
    for (const region of program.candidates(midi, velocity, true)) {
      const sample = program.sample(region);
      if (!sample) continue;
      const source = ctx.createBufferSource();
      source.buffer = sample.buffer;
      source.playbackRate.value = Math.pow(2, ((midi - region.keycenter) * 100 + region.tune) / 1200);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, releaseAt);
      gain.gain.linearRampToValueAtTime(
        staticGain(region, midi, velocity, opts.flattenVelocity) * (opts.trim ?? 1),
        releaseAt + Math.max(0.001, region.attack),
      );
      source.connect(gain);
      gain.connect(bus.input);
      source.start(releaseAt);
      source.onended = () => gain.disconnect();
    }
  }

  return started;
}

/**
 * When the pedal, as the bus knows it at `time`, lets go of a note ending
 * then — or null if it is up. Only the history can answer for an offline
 * render; a live pedal-up arrives through the bus listener and is handled by
 * the bus's held set instead (see BusVoices).
 */
function pedalHoldsUntil(bus: TrackBus, time: number): number | null {
  const pedal = bus.ccAt(CC.sustain, time) ?? 0;
  if (pedal < PEDAL_DOWN) return null;
  const up = bus.ccChanges(CC.sustain, time, Infinity).find(([, value]) => value < PEDAL_DOWN);
  return up ? up[0] : Infinity;
}

function scheduleRelease(voice: Voice, bus: TrackBus, end: number): void {
  const registry = voicesOf(bus);
  const until = pedalHoldsUntil(bus, end);
  if (until === null) return voice.release(end);
  if (until !== Infinity) return voice.release(until);
  // Down with no lift in sight: live playback will lift it, or the pass ends.
  registry.held.add(voice);
}
