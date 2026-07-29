'use strict';

/**
 * schedule.ts — one compiled song, scheduled into one Web Audio graph.
 *
 * Every backend that renders a score with the built-in sounds goes through
 * here: the browser's offline MP3 render, the server-side engine, and the CLI.
 * Before this existed each of them walked the timeline itself, and they drifted
 * — notably, the server and the CLI dropped the score's control stream on the
 * floor, so expression swells, vibrato, bow position and sordino were simply
 * inaudible outside the browser.
 *
 * Live playback (player.ts) still owns its own loop, because it needs a running
 * transport it can hot-swap and re-time; it shares the bus and the synth, not
 * the walk.
 *
 * Samplers are injected rather than imported: the browser can hand over real
 * recordings, and a backend with no sample library just gets the synth presets.
 */

import type { CompiledSong, CompiledTrack } from './song';
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

export interface ScheduleOptions {
  /** Context time that beat `fromBeat` should sound at. Defaults to "now". */
  originTime?: number;
  /** Skip everything before this beat (loop passes, scrubbing). */
  fromBeat?: number;
  /** Stop before this beat. */
  maxBeats?: number;
  /** Only these track names. */
  onlyTracks?: string[];
  /**
   * Recorded instrument for a track, or null/undefined to use the synth
   * preset. Called once per track.
   */
  instrumentFor?: (track: CompiledTrack) => ScheduleInstrument | null | undefined;
  /**
   * How the control stream reaches the bus.
   *
   * `'automation'` (default) schedules it on AudioParams — correct, cheap, and
   * what browsers do.
   *
   * `'segmented'` is for engines that silently ignore AudioParam automation:
   * webaudio-node, which renders server-side playback and the CLI, honours
   * only immediate `param.value` writes, so a scheduled bow position or
   * expression swell never sounds at all. Here the control stream is cut into
   * spans of constant value, each span gets its own bus written outright, and
   * notes are routed to the bus that was current when they started.
   */
  controlMode?: 'automation' | 'segmented';
}

export interface ScheduleResult {
  /** Context time of the last note-off, so callers know when to stop. */
  endTime: number;
  /** Beat of the last note-off — the song's sounding length. */
  endBeat: number;
  /** One bus per scheduled track; dispose them when the pass is done. */
  buses: TrackBus[];
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
): ScheduleResult {
  const segments = tempoSegments(song.bpm || 120, song.tempoMap);
  const fromBeat = opts.fromBeat ?? 0;
  const limit = opts.maxBeats ?? Infinity;
  const origin = opts.originTime ?? ctx.currentTime;
  const skipSec = beatsToSeconds(segments, fromBeat);
  /** Beat → context time. */
  const at = (beat: number) => origin + beatsToSeconds(segments, beat) - skipSec;

  const tracks = song.tracks.filter((t) => !opts.onlyTracks || opts.onlyTracks.includes(t.name));

  const buses: TrackBus[] = [];
  let endTime = origin;
  let endBeat = fromBeat;

  const segmented = opts.controlMode === 'segmented';

  for (const track of tracks) {
    const controls = (track.controls ?? []).filter((c) => c.time < limit);
    const hasExpression = controls.some((c) => c.cc === 11);
    const makeBus = () => {
      const bus = createTrackBus(ctx, destination, { hasExpression, immediate: segmented });
      buses.push(bus);
      return bus;
    };

    // Controls before the entry point still describe the instrument's state —
    // replay the latest value of each at the origin so a loop pass or a scrub
    // starts with the bow where the score left it, not wide open.
    const carried = new Map<number, number>();
    for (const control of controls) {
      if (control.time < fromBeat) carried.set(control.cc, control.value);
    }

    /**
     * Segmented mode: one bus per span of constant control values, built
     * lazily as the timeline advances. `busAt` returns the bus a note
     * starting at this beat belongs to.
     */
    const changeTimes = segmented
      ? [...new Set(controls.filter((c) => c.time >= fromBeat).map((c) => c.time))].sort((a, b) => a - b)
      : [];
    let segmentIndex = -1;
    let currentBus: TrackBus | null = null;
    const liveValues = new Map(carried);

    const busAt = (beat: number): TrackBus => {
      if (!segmented) return currentBus!;
      // Advance through every control change at or before this note.
      let next = segmentIndex;
      while (next + 1 < changeTimes.length && changeTimes[next + 1] <= beat) next++;
      if (next === segmentIndex && currentBus) return currentBus;
      segmentIndex = next;
      for (const control of controls) {
        if (control.time >= fromBeat && control.time <= beat) liveValues.set(control.cc, control.value);
      }
      currentBus = makeBus();
      for (const [cc, value] of liveValues) currentBus.applyCC(cc, value, origin);
      return currentBus;
    };

    if (!segmented) {
      currentBus = makeBus();
      for (const [cc, value] of carried) currentBus.applyCC(cc, value, origin);
      for (const control of controls) {
        if (control.time < fromBeat) continue;
        currentBus.applyCC(control.cc, control.value, at(control.time));
      }
    }

    const instrument = opts.instrumentFor?.(track) ?? null;
    const preset = track.kit ? null : detectPreset(track);

    for (const note of track.timeline) {
      if (note.time < fromBeat || note.time >= limit) continue;
      const bus = busAt(note.time);
      const start = at(note.time);
      const stop = at(Math.min(note.time + note.duration, limit));
      // Tempo-aware: a ramp makes the same beat-length shorter or longer.
      const duration = stop - start;

      if (track.kit) {
        if (instrument?.kind === 'drums') instrument.play(bus, note.midi, note.velocity, start);
        else playDrum(ctx, bus.input, note.midi, note.velocity, start);
      } else if (instrument?.kind === 'melodic') {
        instrument.play(bus, note.midi, note.velocity, start, duration);
      } else {
        playNote(ctx, bus.input, preset!, note.midi, note.velocity, start, duration, bus.vibrato);
      }

      if (stop > endTime) endTime = stop;
      endBeat = Math.max(endBeat, Math.min(note.time + note.duration, limit));
    }
  }

  return { endTime, endBeat, buses };
}

/** The song's sounding length in beats, controls included. */
export function songEndBeat(song: CompiledSong): number {
  let end = 0;
  for (const track of song.tracks) {
    for (const note of track.timeline) end = Math.max(end, note.time + note.duration);
    for (const control of track.controls ?? []) end = Math.max(end, control.time);
  }
  return end;
}
