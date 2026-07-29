'use strict';

/**
 * time.ts — beats → seconds under a tempo map. Playback backends that don't
 * have a tick-based transport (the CLI's timers, offline rendering) use this
 * to place events in wall-clock time, with ramped changes (rit./accel.)
 * stepped exactly the way the .mid export steps them.
 */

import { TempoEvent } from './song';

/** From this beat on, `bpm` holds; `sec` is where the beat sits in seconds. */
export interface TempoSegment {
  beat: number;
  sec: number;
  bpm: number;
}

/** A ramped tempo change is approximated with this many steps. */
const RAMP_STEPS = 16;

/**
 * Flatten a tempo map into piecewise-constant segments starting at beat 0.
 * Ramps become a staircase of RAMP_STEPS levels, matching the SMF export.
 */
export function tempoSegments(bpm: number, tempoMap: TempoEvent[] = []): TempoSegment[] {
  const segments: TempoSegment[] = [{ beat: 0, sec: 0, bpm }];
  const advance = (toBeat: number, newBpm: number) => {
    const last = segments[segments.length - 1];
    const beat = Math.max(last.beat, toBeat);
    segments.push({ beat, sec: last.sec + ((beat - last.beat) * 60) / last.bpm, bpm: newBpm });
  };
  for (const change of [...tempoMap].sort((a, b) => a.time - b.time)) {
    if (change.rampBeats > 0) {
      const from = segments[segments.length - 1].bpm;
      for (let step = 1; step <= RAMP_STEPS; step++) {
        const ratio = step / RAMP_STEPS;
        advance(change.time + change.rampBeats * ratio, from + (change.bpm - from) * ratio);
      }
    } else {
      advance(change.time, change.bpm);
    }
  }
  return segments;
}

/** Where a beat lands in seconds, given segments from tempoSegments(). */
export function beatsToSeconds(segments: TempoSegment[], beat: number): number {
  let seg = segments[0];
  for (const s of segments) {
    if (s.beat <= beat) seg = s;
    else break;
  }
  return seg.sec + (Math.max(0, beat - seg.beat) * 60) / seg.bpm;
}

/**
 * The inverse of beatsToSeconds(): which beat is sounding at this many seconds
 * in. Backends that only know wall-clock elapsed time — the server's playback
 * engine reporting its position to the studio — use this to say where they are.
 */
export function secondsToBeats(segments: TempoSegment[], sec: number): number {
  let seg = segments[0];
  for (const s of segments) {
    if (s.sec <= sec) seg = s;
    else break;
  }
  return seg.beat + (Math.max(0, sec - seg.sec) * seg.bpm) / 60;
}
