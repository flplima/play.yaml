import {
  CC, DEFAULT_VELOCITY, beatsToSeconds, metronomeClick, prepareVpo, tempoSegments, trackVoice,
  type CompiledSong, type Orchestra, type TrackBus,
} from '@play.yaml/core';
import { httpAssets } from './vpo';
import {
  CONTROL_CHANGE, NOTE_OFF, NOTE_ON, allNotesOff, routeKey, sendExpression, wireChannel, type RouteMap,
} from './routes';

export interface PlaybackHandle {
  stop: () => void;
  /** Resolves when playback finishes (or is stopped). */
  done: Promise<void>;
  /**
   * The beat to show, in quarter notes: what the speakers play now, plus
   * VISUAL_LEAD_SEC, plus `extraLeadSec` (the time the caller needs to put
   * it on screen). Negative in the moment before the first note.
   */
  getPositionBeats: (extraLeadSec?: number) => number;
  /** Set master volume (0.0 to 1.0). */
  setVolume: (volume: number) => void;
  /**
   * Hot-swap: splice a recompiled song in at an upcoming bar boundary while
   * the transport keeps running. Resolves with the 1-based bar the splice
   * lands on, or null when it was superseded by a newer update or a stop.
   */
  update: (song: CompiledSong) => Promise<number | null>;
}

export interface PlayOptions {
  loop?: boolean;
  /** 0.0 to 1.0. */
  volume?: number;
  /** Live switch, checked on every beat, so it can be toggled mid-playback. */
  metronome?: () => boolean;
  /**
   * Tracks that wanted the orchestra but fell back to a synth preset —
   * the sample library is not installed, or a program failed to load.
   */
  onOrchestraFallback?: (trackNames: string[]) => void;
}

/**
 * Keys and highlights move this long before you hear the note. A pianist's
 * key is down before the hammer strikes, and sound up to ~125 ms after the
 * picture still reads as in sync, while sound ahead of it shows at ~45 ms
 * (ITU-R BT.1359). 50 ms lets a key finish its 45 ms press as the note lands.
 */
export const VISUAL_LEAD_SEC = 0.05;

/**
 * The context time of the sample leaving the speakers right now. The render
 * clock (`currentTime`) runs ahead of it by the device's output latency: a few
 * ms on wired speakers, 150 ms or more on Bluetooth.
 */
function heardTime(ctx: AudioContext): number {
  const ts = ctx.getOutputTimestamp?.();
  if (ts?.contextTime && ts.performanceTime) {
    const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    const behind = ctx.currentTime - t;
    if (behind > -0.02 && behind < 1) return Math.min(t, ctx.currentTime);
  }
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
}

/**
 * The tempo at `beat`, before any change written exactly there: a bpm, plus
 * the rest of a ramp still running through it.
 */
function tempoAt(s: CompiledSong, beat: number): { bpm: number; rampTo?: number; rampBeats?: number } {
  let bpm = s.bpm;
  for (const change of s.tempoMap) {
    if (change.time >= beat) break;
    const end = change.time + change.rampBeats;
    if (change.rampBeats > 0 && beat < end) {
      const at = bpm + ((change.bpm - bpm) * (beat - change.time)) / change.rampBeats;
      return { bpm: at, rampTo: change.bpm, rampBeats: end - beat };
    }
    bpm = change.bpm;
  }
  return { bpm };
}

/**
 * What a loop pass must put back at `beat` for one track: each control that
 * changes later in the loop, at the value it held before `beat` (undefined:
 * never set yet). Controls written exactly at `beat` replay on their own.
 */
function controlsBefore(track: CompiledSong['tracks'][number], beat: number): Map<number, number | undefined> {
  const before = new Map<number, number | undefined>();
  const at = new Set<number>();
  const later = new Set<number>();
  for (const c of track.controls) {
    if (c.time < beat) before.set(c.cc, c.value);
    else if (c.time === beat) at.add(c.cc);
    else later.add(c.cc);
  }
  const out = new Map<number, number | undefined>();
  for (const cc of later) if (!at.has(cc)) out.set(cc, before.get(cc));
  return out;
}

/**
 * Tone.js is its own chunk, fetched with `import()` instead of with the page.
 * `preloadPlayer` starts that fetch once the page is idle, so the first Play
 * finds it already loaded, and the service worker has cached it for offline.
 */
let tone: Promise<typeof import('tone')> | undefined;
const loadTone = () => (tone ??= import('tone'));
export function preloadPlayer(): void {
  const start = () => void loadTone().catch(() => { tone = undefined; });
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 5000 });
  else setTimeout(start, 2000);
}

/** MIDI has no "unset": these return to off (or centre) on a loop pass. */
const MIDI_START: Record<number, number> = {
  [CC.sustain]: 0, [CC.sostenuto]: 0, [CC.soft]: 0, [CC.sordino]: 0, [CC.pan]: 64,
};

/**
 * Play a compiled song on the Tone.js Transport. Tracks with a MIDI route go
 * out through WebMIDI (timestamped sends); everything else is rendered by the
 * built-in orchestra and synth at transport-accurate times.
 *
 * Hot-swap model: every scheduled transport event belongs to a *generation*
 * (one per spliced-in score). `update()` schedules the incoming generation
 * from the next bar boundary on, cancels the old one from that boundary, and
 * a boundary event retires the old generation's leftovers — so edits land on
 * the barline while the transport never stops.
 */
export async function playSong(
  song: CompiledSong,
  routes: RouteMap,
  midiOutputs: Map<string, MIDIOutput>,
  opts: PlayOptions = {},
): Promise<PlaybackHandle> {
  const Tone = await loadTone();
  await Tone.start(); // Resume the audio context (requires a user gesture).

  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel(0);
  transport.position = 0;
  transport.bpm.value = song.bpm;
  const ppq = transport.PPQ;
  /**
   * Stop any tempo ramp at `time`, at the value it has reached. Unlike
   * cancelScheduledValues this keeps the curve before `time`, so the ticks
   * already counted (and the clock the keys follow) don't move.
   */
  const holdTempo = (time: number) => {
    try {
      transport.bpm.cancelAndHoldAtTime(time);
    } catch {
      // Nothing to hold; the set that follows still lands the tempo.
    }
  };
  const atBeat = (beat: number) => `${Math.round(beat * ppq)}i`;

  const ctx = Tone.getContext().rawContext as AudioContext;
  // Per-playback master gain: lets stop() cut ringing synth tails instantly
  // without touching Tone's shared context.
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, opts.volume ?? 1)), ctx.currentTime);
  masterGain.connect(ctx.destination);

  const usedOutputs = new Set<MIDIOutput>();
  const noteTimers = new Set<number>();
  const activeNotes = new Set<string>(); // "outputId,channel,note"
  const expressionByChannel = new Map<string, number>(); // "outputId,channel" → last CC value
  let orchestra: Orchestra = new Map();

  // Generation bookkeeping for hot-swap.
  let generation = 0;
  const eventIds = new Map<number, number[]>(); // generation → transport event ids
  const busesByGen = new Map<number, TrackBus[]>();
  const resolvers = new Map<number, (bar: number | null) => void>();
  const disposeTimers = new Set<number>();
  let currentSong = song;
  let clicksPerMeasure = Math.max(1, Math.round(song.measureBeats));
  let looping = false;
  let loopStartBeat = 0;
  let loopEndBeat = 0;
  let cleanupEventId: number | null = null;
  let pendingSplice: (() => void) | null = null; // aborts a splice whose driver hasn't fired
  let stopped = false;
  let tailTimer = 0;

  const register = (gen: number, id: number) => {
    let ids = eventIds.get(gen);
    if (!ids) eventIds.set(gen, (ids = []));
    ids.push(id);
  };

  // Never pass a timestamp to send(): Chromium ignores it on several
  // platforms ("we ignore timestamps and just throw stuff over"), which
  // would collapse every note to zero length — silent on any sustained
  // instrument. Instead each message gets its own transport event (so
  // tempo changes stretch it correctly) and we wait out the transport's
  // lookahead with a timer before sending.
  const sendAt = (time: number, emit: () => void) => {
    const delay = Math.max(0, (time - ctx.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      noteTimers.delete(timer);
      emit();
    }, delay);
    noteTimers.add(timer);
  };

  const isRouted = (track: CompiledSong['tracks'][number]) => {
    const route = routes[routeKey(track)];
    return Boolean(route && midiOutputs.get(route.outputId));
  };

  // The orchestra loads before any note is scheduled — only the programs
  // and samples this score's built-in tracks reach, fetched on demand and
  // cached after — so first notes are never fallback oscillators. Tracks
  // routed out to MIDI need nothing.
  const loadOrchestraFor = async (s: CompiledSong) => {
    const fallen: string[] = [];
    orchestra = await prepareVpo(ctx, httpAssets, s, {
      onlyTracks: s.tracks.filter((t) => !isRouted(t)).map((t) => t.name),
      onMissing: (name, err) => {
        fallen.push(name);
        console.warn(`"${name}" plays on a synth preset — the orchestra could not load:`, err);
      },
    });
    if (fallen.length) opts.onOrchestraFallback?.(fallen);
  };

  /**
   * Resolve a song's tracks to voices/outputs once, and return a scheduler
   * that can place any beat window of its events on the transport — the
   * whole song for the first generation, the two sides of the splice
   * boundary for later ones.
   */
  const buildGeneration = (s: CompiledSong, gen: number, initial: boolean) => {
    // Note lengths follow the tempo map, as every offline render's do.
    const segments = tempoSegments(s.bpm, s.tempoMap);
    const seconds = (from: number, to: number) => beatsToSeconds(segments, to) - beatsToSeconds(segments, from);
    const buses: TrackBus[] = [];
    busesByGen.set(gen, buses);
    let endBeat = 0;
    const schedulers: Array<(from: number, to: number) => void> = [];

    // A loop pass starts in the state the first pass had at the loop point,
    // not in the ending's: the tempo, the pedal, the dynamics and every other
    // control. Scheduled first, so the score's own events at the same beat
    // land after it. On the first pass it changes nothing.
    const loopFrom = s.loopStartBeats ?? 0;
    const loopResets: Array<(time: number) => void> = [];
    if (opts.loop) {
      schedulers.push((from, to) => {
        if (loopFrom < from || loopFrom >= to) return;
        register(gen, transport.schedule((time) => {
          const tempo = tempoAt(s, loopFrom);
          holdTempo(time); // an ending's ritardando
          try {
            transport.bpm.setValueAtTime(tempo.bpm, time);
          } catch {
            transport.bpm.value = tempo.bpm;
          }
          if (tempo.rampTo !== undefined && tempo.rampBeats) {
            const seconds = (tempo.rampBeats * 60) / ((tempo.bpm + tempo.rampTo) / 2);
            transport.bpm.linearRampToValueAtTime(tempo.rampTo, time + seconds);
          }
          for (const reset of loopResets) reset(time);
        }, atBeat(loopFrom)));
      });
    }

    for (const track of s.tracks) {
      const route = routes[routeKey(track)];
      const output = route && midiOutputs.get(route.outputId);

      for (const note of track.timeline) {
        endBeat = Math.max(endBeat, note.time + note.duration);
      }

      if (output) {
        usedOutputs.add(output);
        const ch = wireChannel(route.channel);
        const chKey = `${route.outputId},${ch}`;
        const key = (midi: number) => `${chKey},${midi}`;

        if (initial) {
          // Open the channel up front so the instrument has expression before
          // the first note (a physical model otherwise plays nothing until the
          // controller arrives).
          const firstVelocity = track.timeline[0]?.velocity ?? DEFAULT_VELOCITY;
          sendExpression(output, ch, firstVelocity);
          expressionByChannel.set(chKey, firstVelocity);
        }

        const carried = controlsBefore(track, loopFrom);
        if (carried.size) {
          loopResets.push((time) => sendAt(time, () => {
            for (const [cc, value] of carried) {
              const v = value ?? MIDI_START[cc];
              if (v !== undefined) output.send([CONTROL_CHANGE | ch, cc & 0x7f, v & 0x7f]);
            }
          }));
        }

        schedulers.push((from, to) => {
          for (const control of track.controls) {
            if (control.time < from || control.time >= to) continue;
            register(gen, transport.schedule((time) => {
              sendAt(time, () => output.send([CONTROL_CHANGE | ch, control.cc & 0x7f, control.value & 0x7f]));
            }, atBeat(control.time)));
          }
          for (const note of track.timeline) {
            if (note.time < from || note.time >= to) continue;
            register(gen, transport.schedule((time) => {
              sendAt(time, () => {
                // Track the score's dynamics with expression, so velocity means
                // something on instruments that ignore it. Only resend on change.
                if (expressionByChannel.get(chKey) !== note.velocity) {
                  expressionByChannel.set(chKey, note.velocity);
                  sendExpression(output, ch, note.velocity);
                }
                output.send([NOTE_ON | ch, note.midi, note.velocity]);
                activeNotes.add(key(note.midi));
              });
            }, atBeat(note.time)));

            // Scheduled separately in ticks so a gate over 1 overlaps the next
            // note (which is how a slur is signalled) and tempo changes still
            // apply.
            register(gen, transport.schedule((time) => {
              sendAt(time, () => {
                output.send([NOTE_OFF | ch, note.midi, 0]);
                activeNotes.delete(key(note.midi));
              });
            }, atBeat(note.time + note.duration)));
          }
        });
      } else {
        const voice = trackVoice(ctx, masterGain, track, orchestra.get(track.name));
        buses.push(voice.bus);
        const carried = controlsBefore(track, loopFrom);
        if (carried.size) {
          loopResets.push((time) => {
            for (const [cc, value] of carried) {
              if (value === undefined) voice.bus.resetCC(cc, time);
              else voice.bus.applyCC(cc, value, time);
            }
          });
        }

        schedulers.push((from, to) => {
          for (const control of track.controls) {
            if (control.time < from || control.time >= to) continue;
            // Scheduled ahead of the notes at the same beat (insertion order),
            // so articulation switches land before the note that needs them.
            register(gen, transport.schedule((time) => {
              voice.bus.applyCC(control.cc, control.value, time);
            }, atBeat(control.time)));
          }
          for (const note of track.timeline) {
            if (note.time < from || note.time >= to) continue;
            register(gen, transport.schedule((time) => {
              // One bad voice must never break the transport's callback batch —
              // an uncaught throw here silences every event after it in the tick.
              try {
                voice.play(note, time, seconds(note.time, note.time + note.duration));
              } catch (err) {
                console.warn(`Voice failed (${track.name} @${note.time}):`, err);
              }
            }, atBeat(note.time)));
          }
        });
      }
    }

    // Tempo map: everything above is scheduled in ticks, so changing the
    // transport's bpm stretches notes, controls and highlighting together.
    schedulers.push((from, to) => {
      let runningBpm = s.bpm;
      for (const change of s.tempoMap) {
        const fromBpm = runningBpm;
        runningBpm = change.bpm;
        if (change.time < from || change.time >= to) continue;
        register(gen, transport.schedule((time) => {
          // transport.bpm is a TickSignal backing transport.ticks. A change can
          // land inside a ramp that hasn't finished: stop it there first.
          holdTempo(time);
          if (change.rampBeats > 0) {
            // Ramp length in seconds, using the average of the two tempi.
            const seconds = (change.rampBeats * 60) / ((fromBpm + change.bpm) / 2);
            transport.bpm.setValueAtTime(fromBpm, time);
            transport.bpm.linearRampToValueAtTime(change.bpm, time + seconds);
          } else {
            transport.bpm.setValueAtTime(change.bpm, time);
          }
        }, atBeat(change.time)));
      }
    });

    return {
      endBeat,
      scheduleWindow: (from: number, to: number) => schedulers.forEach((fn) => fn(from, to)),
    };
  };

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(tailTimer);
    for (const timer of disposeTimers) window.clearTimeout(timer);
    disposeTimers.clear();
    transport.stop();
    transport.cancel(0);
    for (const timer of noteTimers) window.clearTimeout(timer);
    noteTimers.clear();
    for (const entry of activeNotes) {
      const [outputId, channel, midi] = entry.split(',');
      midiOutputs.get(outputId)?.send([NOTE_OFF | Number(channel), Number(midi), 0]);
    }
    activeNotes.clear();
    for (const output of usedOutputs) allNotesOff(output);
    for (const resolve of resolvers.values()) resolve(null);
    resolvers.clear();
    masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    window.setTimeout(() => {
      masterGain.disconnect();
      for (const buses of busesByGen.values()) for (const bus of buses) bus.dispose();
      busesByGen.clear();
    }, 300);
    finished();
  };

  // Loop over whole measures (falling back to the last note when a track
  // overhangs); otherwise let the final release ring briefly, then clean up.
  // A sections document with a forever-loop plays its intro once and cycles
  // from loopStartBeats; classic documents cycle the whole song.
  const applyEnds = (s: CompiledSong, gen: number, endBeat: number, minBeat = 0) => {
    const songEnd = Math.max(s.lengthBeats, endBeat);
    if (opts.loop && songEnd > 0) {
      looping = true;
      loopStartBeat = Math.min(s.loopStartBeats ?? 0, songEnd);
      loopEndBeat = songEnd;
      transport.loopStart = atBeat(loopStartBeat);
      transport.loopEnd = atBeat(loopEndBeat);
      transport.loop = true;
    } else {
      looping = false;
      transport.loop = false;
      cleanupEventId = transport.schedule(() => {
        tailTimer = window.setTimeout(cleanup, 600);
      }, atBeat(Math.max(songEnd, minBeat)));
      register(gen, cleanupEventId);
    }
  };

  let finished!: () => void;
  const done = new Promise<void>((resolve) => (finished = resolve));

  await loadOrchestraFor(song);
  const first = buildGeneration(song, 0, true);
  first.scheduleWindow(0, Infinity);

  // Metronome: one click per beat on the transport grid, for every
  // generation. The grid runs at the song's root tempo — child-track tempo
  // overrides never reach the transport.
  const metronomeOn = opts.metronome ?? (() => false);
  transport.scheduleRepeat((time) => {
    if (!metronomeOn()) return;
    const ticks = transport.getTicksAtTime(time);
    const beat = Math.round(ticks / ppq) % clicksPerMeasure;
    metronomeClick(ctx, masterGain, time, beat === 0);
  }, `${ppq}i`, 0);

  applyEnds(song, 0, first.endBeat);
  // Tone starts a lookahead (100 ms) from now; keep the moment for the clock.
  const startAt = Tone.now();
  transport.start(startAt);

  const update = async (next: CompiledSong): Promise<number | null> => {
    if (stopped) return null;
    pendingSplice?.();
    pendingSplice = null;
    const gen = ++generation;

    await loadOrchestraFor(next);
    if (stopped || gen !== generation) return null;

    // Near the end of a non-looping song, the old cleanup could stop the
    // transport before the splice lands — the new generation reschedules it.
    if (!looping && cleanupEventId != null) {
      transport.clear(cleanupEventId);
      cleanupEventId = null;
    }

    const mb = next.measureBeats;
    const bpmNow = transport.bpm.value;
    // The splice driver runs `lead` beats before the boundary: enough that
    // its events land on the timeline before the transport's head sweeps
    // those ticks (~0.35 s), but under half the loop so it stays in range.
    let lead = Math.max(0.35 * (bpmNow / 60), mb / 8);
    if (looping) lead = Math.min(lead, (loopEndBeat - loopStartBeat) / 2);
    const pos = transport.ticks / ppq;
    let boundary = Math.ceil((pos + lead * 2) / mb) * mb;
    if (looping && boundary >= loopEndBeat - 1e-6) {
      // The next boundary is the wrap itself, where boundary-tick events never
      // fire. Splice on the first full bar of the next pass instead: events
      // scheduled behind the head only fire after the wrap, so the current
      // pass finishes on the old score.
      boundary = Math.ceil((loopStartBeat + lead) / mb) * mb;
    }

    const prep = buildGeneration(next, gen, false);
    let fired = false;
    let spliced = false;
    const barNumber = Math.round(boundary / mb) + 1;
    const result = new Promise<number | null>((resolve) => resolvers.set(gen, resolve));

    const driver = transport.schedule(() => {
      if (fired || stopped) return;
      fired = true;
      pendingSplice = null;

      transport.cancel(atBeat(boundary));

      // Boundary event — scheduled first at its tick (same-tick events fire
      // in insertion order), so the handover happens before the new downbeat.
      register(gen, transport.schedule((time) => {
        if (spliced || stopped) return;
        spliced = true;

        // Retire every other generation: clear its remaining events (safe
        // no-op for ones already cancelled or dispatched)…
        for (const [g, ids] of eventIds) {
          if (g === gen) continue;
          for (const id of ids) transport.clear(id);
          eventIds.delete(g);
          resolvers.get(g)?.(null);
          resolvers.delete(g);
        }
        // …and let its buses ring out their releases before disposal.
        for (const [g, buses] of busesByGen) {
          if (g === gen) continue;
          busesByGen.delete(g);
          const timer = window.setTimeout(() => {
            disposeTimers.delete(timer);
            for (const bus of buses) bus.dispose();
          }, 8000);
          disposeTimers.add(timer);
        }
        // Old MIDI notes held across the boundary lost their note-offs with
        // the old generation — release them on the barline.
        const held = [...activeNotes];
        if (held.length) {
          sendAt(time, () => {
            for (const entry of held) {
              const [outputId, channel, midi] = entry.split(',');
              midiOutputs.get(outputId)?.send([NOTE_OFF | Number(channel), Number(midi), 0]);
              activeNotes.delete(entry);
            }
          });
        }
        // Land on the new score's effective tempo at the boundary.
        let effBpm = next.bpm;
        for (const change of next.tempoMap) {
          if (change.time <= boundary) effBpm = change.bpm;
        }
        const tempoTouched = next.tempoMap.length > 0
          || currentSong.tempoMap.length > 0
          || next.bpm !== currentSong.bpm;
        if (tempoTouched) {
          try {
            transport.bpm.cancelScheduledValues(time);
          } catch {
            // TickSignal automation can refuse mid-ramp cancels; the set below
            // still lands the right tempo.
          }
          try {
            transport.bpm.setValueAtTime(effBpm, time);
          } catch {
            transport.bpm.value = effBpm;
          }
        }
        // Later loop passes need the bars before the boundary too. These land
        // behind the transport's head, so they first fire after the wrap.
        if (opts.loop) prep.scheduleWindow(0, boundary);
        applyEnds(next, gen, prep.endBeat, boundary);
        currentSong = next;
        clicksPerMeasure = Math.max(1, Math.round(next.measureBeats));
        resolvers.get(gen)?.(barNumber);
        resolvers.delete(gen);
      }, atBeat(boundary)));

      prep.scheduleWindow(boundary, Infinity);
    }, atBeat(boundary - lead));
    register(gen, driver);

    pendingSplice = () => {
      if (fired) return; // already in motion — the next splice will retire it
      fired = true;
      spliced = true;
      for (const id of eventIds.get(gen) ?? []) transport.clear(id);
      eventIds.delete(gen);
      for (const bus of busesByGen.get(gen) ?? []) bus.dispose();
      busesByGen.delete(gen);
      resolvers.get(gen)?.(null);
      resolvers.delete(gen);
    };

    return result;
  };

  return {
    stop: cleanup,
    done,
    // Not `transport.ticks`: that reads Tone's scheduling clock, a lookahead
    // ahead of the audio, and ignores the speakers' latency.
    getPositionBeats: (extraLeadSec = 0) => {
      if (stopped) return 0;
      const t = heardTime(ctx) + VISUAL_LEAD_SEC + extraLeadSec;
      if (t < startAt) return ((t - startAt) * song.bpm) / 60;
      return transport.getTicksAtTime(t) / ppq;
    },
    setVolume: (v: number) => {
      masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime);
    },
    update,
  };
}
