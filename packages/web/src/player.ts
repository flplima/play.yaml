import * as Tone from 'tone';
import type { CompiledSong } from '@play.yaml/core';
import { detectPreset, metronomeClick, panicMessages, playDrum, playNote } from '@play.yaml/core';
import {
  createTrackBus, DRUM_LIBRARY, loadInstrument, Sampler, SAMPLE_LIBRARIES, TrackBus,
} from './sampler';

/** Where a sample (the DSL's instrument name) should be routed. */
export interface MidiRoute {
  outputId: string;
  channel: number; // 1-16
}

/** Keyed by sample name — "cello", "piano", … */
export type RouteMap = Record<string, MidiRoute | undefined>;

/** The routing key for a compiled track: its kit, else its sample. */
export function routeKey(track: { sample?: string; kit?: string }): string {
  return track.kit ?? track.sample ?? 'piano';
}

export interface PlaybackHandle {
  stop: () => void;
  /** Resolves when playback finishes (or is stopped). */
  done: Promise<void>;
  /** Current transport position in beats (quarter notes). */
  getPositionBeats: () => number;
  /** Set master volume (0.0 to 1.0). */
  setVolume: (volume: number) => void;
  /**
   * Hot-swap: splice a recompiled song in at an upcoming bar boundary while
   * the transport keeps running. Resolves with the 1-based bar the splice
   * lands on, or null when it was superseded by a newer update or a stop.
   */
  update: (song: CompiledSong) => Promise<number | null>;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CC = 0xb0;
const CC_BREATH = 2;
const CC_EXPRESSION = 11;

/**
 * Physical-modeling instruments (SWAM and friends) take their loudness from
 * the expression controller rather than from note velocity: a bowed or blown
 * voice with expression at zero has zero bow speed / breath pressure, so it
 * stays silent however many notes arrive. Send expression alongside the notes.
 * CC11 is the default mapping in keyboard mode and CC2 in wind-controller
 * mode, so both go out; instruments that use neither simply ignore them.
 */
function sendExpression(output: MIDIOutput, channel: number, value: number): void {
  const v = Math.max(0, Math.min(127, Math.round(value)));
  output.send([CC | channel, CC_EXPRESSION, v]);
  output.send([CC | channel, CC_BREATH, v]);
}

function allNotesOff(output: MIDIOutput) {
  try {
    // Drop any timestamped messages still queued. In the spec but missing
    // from TS's lib.dom, and optional in some implementations.
    (output as MIDIOutput & { clear?: () => void }).clear?.();
  } catch {
    // Ignore.
  }
  // Pedals first, then the blanket kills: All Notes Off leaves damper-held
  // notes sounding, so a score holding the sustain pedal rang on after Stop.
  // See core's midiPanic for the order.
  for (const msg of panicMessages()) {
    try {
      output.send([CC | msg.channel, msg.controller, msg.value]);
    } catch {
      // Ignore — the device may have been unplugged mid-playback.
    }
  }
}

/** Send a short middle-C blip so the user can verify a device/channel mapping. */
export function sendTestNote(output: MIDIOutput, channel: number, note = 60): void {
  const ch = (channel - 1) & 0x0f;
  sendExpression(output, ch, 100); // else bowed/blown instruments test silently
  output.send([NOTE_ON | ch, note, 100]);
  // Held open by a timer rather than a send() timestamp — see playSong().
  window.setTimeout(() => output.send([NOTE_OFF | ch, note, 0]), 400);
}

/**
 * Play a compiled song on the Tone.js Transport. Tracks with a MIDI route go
 * out through WebMIDI (timestamped sends); everything else is rendered by the
 * built-in Web Audio synth at transport-accurate times.
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
  opts: {
    loop?: boolean;
    volume?: number;
    /** Live switch, checked on every beat, so it can be toggled mid-playback. */
    metronome?: () => boolean;
  } = {},
): Promise<PlaybackHandle> {
  await Tone.start(); // Resume the audio context (requires a user gesture).

  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel(0);
  transport.position = 0;

  const bpm = song.bpm || 120;
  transport.bpm.value = bpm;
  const ppq = transport.PPQ;
  const atBeat = (beat: number) => `${Math.round(beat * ppq)}i`;

  const ctx = Tone.getContext().rawContext as AudioContext;
  // Per-playback master gain: lets stop() cut ringing synth tails instantly
  // without touching Tone's shared context.
  const masterGain = ctx.createGain();
  const initialVol = opts.volume != null ? Math.max(0, Math.min(1, opts.volume)) : 1.0;
  masterGain.gain.setValueAtTime(initialVol, ctx.currentTime);
  masterGain.connect(ctx.destination);

  const usedOutputs = new Set<MIDIOutput>();
  const noteTimers = new Set<number>();
  const activeNotes = new Set<string>(); // "outputId,channel,note"
  const expressionByChannel = new Map<string, number>(); // "outputId,channel" → last CC value
  const samplers = new Map<string, Sampler | null>();

  // Generation bookkeeping for hot-swap.
  let generation = 0;
  const eventIds = new Map<number, number[]>(); // generation → transport event ids
  const busesByGen = new Map<number, TrackBus[]>();
  const resolvers = new Map<number, (bar: number | null) => void>();
  const disposeTimers = new Set<number>();
  let currentSong = song;
  let clicksPerMeasure = Math.max(1, Math.round(song.measureBeats || 4));
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

  // Sampled instruments load once (a few MB each, then browser-cached) before
  // their notes are scheduled, so first notes aren't fallback oscillators.
  // Every sampled kit shares the drum library; the 808 kit is always
  // synthesized.
  const loadSamplersFor = async (s: CompiledSong) => {
    const wanted = new Set<string>();
    for (const track of s.tracks) {
      const route = routes[routeKey(track)];
      if (route && midiOutputs.get(route.outputId)) continue;
      if (track.kit) {
        if (track.kit !== '808') wanted.add(DRUM_LIBRARY);
      } else {
        const library = SAMPLE_LIBRARIES[track.sample?.toLowerCase() ?? ''];
        if (library) wanted.add(library);
      }
    }
    await Promise.all([...wanted].filter((n) => !samplers.has(n)).map(async (name) => {
      samplers.set(name, await loadInstrument(ctx, name));
    }));
  };

  /**
   * Resolve a song's tracks to buses/outputs once, and return a scheduler
   * that can place any beat window of its events on the transport — the
   * whole song for the first generation, the two sides of the splice
   * boundary for later ones.
   */
  const buildGeneration = (s: CompiledSong, gen: number, initial: boolean) => {
    const secPerBeat = 60 / (s.bpm || 120);
    const buses: TrackBus[] = [];
    busesByGen.set(gen, buses);
    let endBeat = 0;
    const schedulers: Array<(from: number, to: number) => void> = [];

    for (const track of s.tracks) {
      const route = routes[routeKey(track)];
      const output = route && midiOutputs.get(route.outputId);

      for (const note of track.timeline) {
        endBeat = Math.max(endBeat, note.time + note.duration);
      }

      if (output) {
        usedOutputs.add(output);
        const ch = (route.channel - 1) & 0x0f;
        const key = (midi: number) => `${route.outputId},${ch},${midi}`;

        if (initial) {
          // Open the channel up front so the instrument has expression before
          // the first note (SWAM otherwise warns "Expression controller not
          // received").
          const firstVelocity = track.timeline[0]?.velocity ?? 90;
          sendExpression(output, ch, firstVelocity);
          expressionByChannel.set(`${route.outputId},${ch}`, firstVelocity);
        }

        schedulers.push((from, to) => {
          for (const control of track.controls ?? []) {
            if (control.time < from || control.time >= to) continue;
            register(gen, transport.schedule((time) => {
              sendAt(time, () => output.send([CC | ch, control.cc & 0x7f, control.value & 0x7f]));
            }, atBeat(control.time)));
          }
          for (const note of track.timeline) {
            if (note.time < from || note.time >= to) continue;
            register(gen, transport.schedule((time) => {
              sendAt(time, () => {
                // Track the score's dynamics with expression, so velocity means
                // something on instruments that ignore it. Only resend on change.
                const chKey = `${route.outputId},${ch}`;
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
        // Built-in rendering: every track gets a control bus so the score's CC
        // stream (expression swells, bow-position drifts, vibrato, pizzicato)
        // shapes the sound, whether sampled or synthesized.
        const preset = track.kit ? null : detectPreset(track);
        const bus = createTrackBus(ctx, masterGain, {
          hasExpression: (track.controls ?? []).some((c) => c.cc === 11),
          usesCC: new Set((track.controls ?? []).map((c) => c.cc)),
        });
        buses.push(bus);
        const sampled = track.kit
          ? (track.kit !== '808' ? samplers.get(DRUM_LIBRARY) : null)
          : samplers.get(SAMPLE_LIBRARIES[track.sample?.toLowerCase() ?? '']) || null;

        schedulers.push((from, to) => {
          for (const control of track.controls ?? []) {
            if (control.time < from || control.time >= to) continue;
            // Scheduled ahead of the notes at the same beat (insertion order),
            // so articulation switches land before the note that needs them.
            register(gen, transport.schedule((time) => {
              bus.applyCC(control.cc, control.value, time);
            }, atBeat(control.time)));
          }
          for (const note of track.timeline) {
            if (note.time < from || note.time >= to) continue;
            register(gen, transport.schedule((time) => {
              // One bad voice must never break the transport's callback batch —
              // an uncaught throw here silences every event after it in the tick.
              try {
                if (track.kit) {
                  if (sampled?.kind === 'drums') sampled.play(bus, note.midi, note.velocity, time);
                  else playDrum(ctx, bus.input, note.midi, note.velocity, time);
                } else if (sampled?.kind === 'melodic') {
                  sampled.play(bus, note.midi, note.velocity, time, note.duration * secPerBeat);
                } else {
                  playNote(ctx, bus.input, preset!, note.midi, note.velocity, time, note.duration * secPerBeat);
                }
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
      let runningBpm = s.bpm || 120;
      for (const change of s.tempoMap ?? []) {
        const fromBpm = runningBpm;
        runningBpm = change.bpm;
        if (change.time < from || change.time >= to) continue;
        register(gen, transport.schedule((time) => {
          // transport.bpm is a TickSignal backing transport.ticks; every change
          // is scheduled strictly later than the last, so nothing to cancel.
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
    // Release anything still sounding before the panic messages.
    for (const entry of activeNotes) {
      const [outputId, channel, midi] = entry.split(',');
      midiOutputs.get(outputId)?.send([NOTE_OFF | Number(channel), Number(midi), 0]);
    }
    activeNotes.clear();
    for (const output of usedOutputs) allNotesOff(output);
    for (const resolve of resolvers.values()) resolve(null);
    resolvers.clear();
    // Fade the master bus out fast, then detach it.
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
    const songEnd = Math.max(s.lengthBeats || 0, endBeat);
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

  await loadSamplersFor(song);
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
  transport.start();

  const update = async (next: CompiledSong): Promise<number | null> => {
    if (stopped) return null;
    pendingSplice?.();
    pendingSplice = null;
    const gen = ++generation;

    await loadSamplersFor(next);
    if (stopped || gen !== generation) return null;

    // Near the end of a non-looping song, the old cleanup could stop the
    // transport before the splice lands — the new generation reschedules it.
    if (!looping && cleanupEventId != null) {
      transport.clear(cleanupEventId);
      cleanupEventId = null;
    }

    const mb = Math.max(1e-6, next.measureBeats || 4);
    const bpmNow = transport.bpm.value || 120;
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

      // From the boundary on, the timeline belongs to the new generation.
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
        let effBpm = next.bpm || 120;
        for (const change of next.tempoMap ?? []) {
          if (change.time <= boundary) effBpm = change.bpm;
        }
        const tempoTouched = (next.tempoMap?.length ?? 0) > 0
          || (currentSong.tempoMap?.length ?? 0) > 0
          || (next.bpm || 120) !== (currentSong.bpm || 120);
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
        clicksPerMeasure = Math.max(1, Math.round(next.measureBeats || 4));
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
    getPositionBeats: () => (stopped ? 0 : transport.ticks / ppq),
    setVolume: (v: number) => {
      const vol = Math.max(0, Math.min(1, v));
      masterGain.gain.setValueAtTime(vol, ctx.currentTime);
    },
    update,
  };
}
