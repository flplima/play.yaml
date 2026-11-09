'use strict';

/**
 * schedule.ts — how a compiled track becomes sound, and how a whole song is
 * laid onto one Web Audio graph.
 *
 * `trackVoice` is the one place a track turns into a bus and a way to play
 * its notes: on a sampled instrument when the backend hands one over, else
 * on the synth presets. The browser's live transport and every offline
 * render (the MP3 download, the CLI) go through it, so a sampled cello, its
 * synth fallback and the control stream that shapes both behave the same
 * wherever the score is heard.
 *
 * `scheduleSong` walks a song in context time for the offline renders. Live
 * playback (web player.ts) owns its own walk, because it needs a running
 * transport it can hot-swap and re-time; it shares the voices, not the walk.
 */

import type { CompiledSong, CompiledTrack, TimelineEvent } from './song';
import { CC } from './vocabulary';
import { tempoSegments, beatsToSeconds } from './time';
import { createTrackBus, TrackBus } from './bus';
import { detectPreset, playDrum, playNote } from './synth';

/** What a backend must provide to play a track with recorded samples. */
export interface ScheduleMelodic {
  kind: 'melodic';
  play: (bus: TrackBus, midi: number, velocity: number, time: number, duration: number) => void;
}
export interface ScheduleDrums {
  kind: 'drums';
  /** A struck sound has no length to honour — it decays as recorded. */
  play: (bus: TrackBus, midi: number, velocity: number, time: number) => void;
}
export type ScheduleInstrument = ScheduleMelodic | ScheduleDrums;

/** Sampled instruments by track name — what `prepareVpo` produces. */
export type Orchestra = Map<string, ScheduleInstrument>;

export interface TrackVoice {
  bus: TrackBus;
  /** Sound one note at a context time, for a length in seconds. */
  play: (note: TimelineEvent, time: number, durationSec: number) => void;
}

/**
 * A track's bus and voice. The bus is shaped by the control stream the track
 * carries; the voice is the sampled instrument when there is one, otherwise
 * the synth preset (or kit) the track's name picks.
 */
export function trackVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  track: CompiledTrack,
  instrument: ScheduleInstrument | undefined,
): TrackVoice {
  const bus = createTrackBus(ctx, destination, {
    hasExpression: track.controls.some((c) => c.cc === CC.expression),
    usesCC: new Set(track.controls.map((c) => c.cc)),
  });
  const preset = track.kit ? null : detectPreset(track);
  const play = (note: TimelineEvent, time: number, durationSec: number) => {
    if (track.kit) {
      if (instrument?.kind === 'drums') instrument.play(bus, note.midi, note.velocity, time);
      else playDrum(ctx, bus.input, note.midi, note.velocity, time);
    } else if (instrument?.kind === 'melodic') {
      instrument.play(bus, note.midi, note.velocity, time, durationSec);
    } else {
      playNote(ctx, bus.input, preset!, note.midi, note.velocity, time, durationSec, bus.vibrato);
    }
  };
  return { bus, play };
}

export interface ScheduleOptions {
  /** Context time that beat `fromBeat` should sound at. Defaults to "now". */
  originTime?: number;
  /** Skip everything before this beat (loop passes, scrubbing). */
  fromBeat?: number;
  /** Stop before this beat. */
  maxBeats?: number;
  /** Sampled instruments by track name; tracks without one play on the synth presets. */
  orchestra?: Orchestra;
}

/**
 * Walk the song and schedule it. Returns when everything is queued — the audio
 * itself plays out of the context afterwards.
 */
export function scheduleSong(
  ctx: BaseAudioContext,
  destination: AudioNode,
  song: CompiledSong,
  opts: ScheduleOptions = {},
): void {
  const segments = tempoSegments(song.bpm, song.tempoMap);
  const fromBeat = opts.fromBeat ?? 0;
  const limit = opts.maxBeats ?? Infinity;
  const origin = opts.originTime ?? ctx.currentTime;
  const skipSec = beatsToSeconds(segments, fromBeat);
  const at = (beat: number) => origin + beatsToSeconds(segments, beat) - skipSec;

  for (const track of song.tracks) {
    const voice = trackVoice(ctx, destination, track, opts.orchestra?.get(track.name));

    // Controls before the entry point still describe the instrument's state —
    // replay the latest value of each at the origin so a loop pass or a scrub
    // starts with the bow where the score left it, not wide open.
    const controls = track.controls.filter((c) => c.time < limit);
    const carried = new Map<number, number>();
    for (const control of controls) {
      if (control.time < fromBeat) carried.set(control.cc, control.value);
    }
    for (const [cc, value] of carried) voice.bus.applyCC(cc, value, origin);
    for (const control of controls) {
      if (control.time >= fromBeat) voice.bus.applyCC(control.cc, control.value, at(control.time));
    }

    for (const note of track.timeline) {
      if (note.time < fromBeat || note.time >= limit) continue;
      const start = at(note.time);
      // Tempo-aware: a ramp makes the same beat-length shorter or longer.
      voice.play(note, start, at(Math.min(note.time + note.duration, limit)) - start);
    }
  }
}

/** The song's sounding length in beats, controls included. */
export function songEndBeat(song: CompiledSong): number {
  let end = 0;
  for (const track of song.tracks) {
    for (const note of track.timeline) end = Math.max(end, note.time + note.duration);
    for (const control of track.controls) end = Math.max(end, control.time);
  }
  return end;
}
