import type { CompiledSong } from '@play.yaml/core';

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
  sampleOrKit: string;
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
  isRamping?: boolean;
}

const CC_NAMES: Record<number, string> = {
  1: 'Vibrato',
  2: 'Breath',
  7: 'Volume',
  10: 'Pan',
  11: 'Expression',
  20: 'Playmode',
  25: 'Fingering',
  64: 'Sustain',
  71: 'Pressure',
  74: 'Bow',
};

export function calculateRealTempo(
  song: CompiledSong | null | undefined,
  beat: number,
): RealTempoInfo {
  if (!song) return { bpm: 120, baseBpm: 120 };

  const baseBpm = song.bpm || 120;
  let runningBpm = baseBpm;

  for (const change of song.tempoMap ?? []) {
    const fromBpm = runningBpm;
    if (beat < change.time) {
      break;
    }
    if (change.rampBeats > 0 && beat < change.time + change.rampBeats) {
      const progress = (beat - change.time) / change.rampBeats;
      const currentBpm = Math.round(fromBpm + (change.bpm - fromBpm) * progress);
      const isAccel = change.bpm > fromBpm;
      return {
        bpm: currentBpm,
        baseBpm,
        effectLabel: `${isAccel ? 'accel.' : 'rit.'} → ${change.bpm} bpm`,
        isRamping: true,
      };
    }
    runningBpm = change.bpm;
  }

  const effectLabel = runningBpm !== baseBpm ? `set to ${runningBpm} bpm` : undefined;

  return {
    bpm: runningBpm,
    baseBpm,
    effectLabel,
    isRamping: false,
  };
}

export function getLiveTrackStates(
  song: CompiledSong | null | undefined,
  beat: number,
): LiveTrackState[] {
  if (!song) return [];

  return song.tracks.map((track) => {
    // 1. Last note at or before `beat`
    let lastNote: LiveNoteInfo | null = null;
    let maxTime = -1;

    for (const note of track.timeline) {
      if (note.time <= beat && note.time > maxTime) {
        maxTime = note.time;
        lastNote = {
          pitch: note.pitch,
          midi: note.midi,
          velocity: note.velocity,
          duration: note.duration,
          time: note.time,
          isSounding: beat >= note.time && beat < note.time + note.duration,
        };
      }
    }

    // 2. Expression (CC11 or CC2)
    let expression = 90;
    let foundExpr = false;
    for (const c of track.controls ?? []) {
      if ((c.cc === 11 || c.cc === 2) && c.time <= beat) {
        expression = c.value;
        foundExpr = true;
      }
    }
    if (!foundExpr) {
      if (lastNote) {
        expression = lastNote.velocity;
      } else if (track.timeline[0]) {
        expression = track.timeline[0].velocity;
      }
    }

    // 3. Sustain (CC64)
    let sustain = 0;
    for (const c of track.controls ?? []) {
      if (c.cc === 64 && c.time <= beat) {
        sustain = c.value;
      }
    }

    // 4. Other CCs
    const latestCcMap = new Map<number, number>();
    for (const c of track.controls ?? []) {
      if (c.time <= beat && c.cc !== 11 && c.cc !== 2 && c.cc !== 64) {
        latestCcMap.set(c.cc, c.value);
      }
    }

    const controls: LiveControlInfo[] = Array.from(latestCcMap.entries()).map(
      ([cc, value]) => ({
        cc,
        name: CC_NAMES[cc] || `CC${cc}`,
        value,
      }),
    );

    return {
      name: track.name,
      sampleOrKit: track.kit ? `kit: ${track.kit}` : (track.sample || 'piano'),
      channel: track.channel,
      lastNote,
      expression,
      sustain,
      controls,
    };
  });
}
