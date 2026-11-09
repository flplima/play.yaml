/**
 * liveState.ts — what the score says is happening at a beat, for the track
 * monitor: the tempo in force, each track's last note and control values.
 */
import { CC, DEFAULT_CONTROLS, DEFAULT_VELOCITY, type CompiledSong } from '@play.yaml/core';

export interface LiveNoteInfo {
  pitch: string;
  midi: number;
  velocity: number;
  duration: number;
  time: number;
  isSounding: boolean;
}

export interface LiveControlInfo {
  name: string;
  cc: number;
  value: number;
}

export interface LiveTrackState {
  name: string;
  channel: number;
  lastNote: LiveNoteInfo | null;
  expression: number;
  sustain: number;
  controls: LiveControlInfo[];
}

export interface RealTempoInfo {
  bpm: number;
  baseBpm: number;
  effectLabel?: string;
}

/** The named controls, by CC, as the monitor labels them. */
const CC_NAMES: Record<number, string> = Object.fromEntries([
  ...Object.entries(DEFAULT_CONTROLS).map(([name, spec]) => [spec.cc, name]),
  [CC.vibratoRate, 'vibrato rate'],
  [CC.playmode, 'playmode'],
  [CC.tremolo, 'tremolo'],
  [CC.sordino, 'sordino'],
]);

export function calculateRealTempo(song: CompiledSong | null | undefined, beat: number): RealTempoInfo {
  if (!song) return { bpm: 0, baseBpm: 0 };
  const baseBpm = song.bpm;
  let runningBpm = baseBpm;
  for (const change of song.tempoMap) {
    if (beat < change.time) break;
    if (change.rampBeats > 0 && beat < change.time + change.rampBeats) {
      const progress = (beat - change.time) / change.rampBeats;
      return {
        bpm: Math.round(runningBpm + (change.bpm - runningBpm) * progress),
        baseBpm,
        effectLabel: `${change.bpm > runningBpm ? 'accel.' : 'rit.'} → ${change.bpm} bpm`,
      };
    }
    runningBpm = change.bpm;
  }
  return {
    bpm: runningBpm,
    baseBpm,
    effectLabel: runningBpm !== baseBpm ? `set to ${runningBpm} bpm` : undefined,
  };
}

export function getLiveTrackStates(song: CompiledSong | null | undefined, beat: number): LiveTrackState[] {
  if (!song) return [];
  return song.tracks.map((track) => {
    let lastNote: LiveNoteInfo | null = null;
    for (const note of track.timeline) {
      if (note.time <= beat && note.time > (lastNote?.time ?? -1)) {
        lastNote = { ...note, isSounding: beat < note.time + note.duration };
      }
    }

    const latest = new Map<number, number>();
    for (const c of track.controls) if (c.time <= beat) latest.set(c.cc, c.value);
    const isExpression = (cc: number) => cc === CC.expression || cc === CC.breath;
    // Without an expression stream, velocity is the dynamic.
    const expression = latest.get(CC.expression) ?? latest.get(CC.breath)
      ?? lastNote?.velocity ?? track.timeline[0]?.velocity ?? DEFAULT_VELOCITY;
    const controls: LiveControlInfo[] = [...latest]
      .filter(([cc]) => !isExpression(cc) && cc !== CC.sustain)
      .map(([cc, value]) => ({ cc, name: CC_NAMES[cc] ?? `CC${cc}`, value }));

    return {
      name: track.name,
      channel: track.channel,
      lastNote,
      expression,
      sustain: latest.get(CC.sustain) ?? 0,
      controls,
    };
  });
}
