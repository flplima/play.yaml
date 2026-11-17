/**
 * HarmonyView.tsx — the harmony sounding at the transport position.
 *
 * The piano roll shows notes, which are one voice at a time; harmony is what
 * several of them *are* together. So this view throws the octave and the
 * voicing away and keeps only the pitch classes, then draws them twice: on a
 * pitch clock, where a chord has a shape that is the same in every key (a
 * major triad is one triangle, turned), and on a Tonnetz, where the shape is a
 * place, and a chord progression leaves a path.
 *
 * Symbolic only: it reads the compiled timeline, never the audio. Percussion
 * is left out, since a snare has no pitch class worth lighting. Everything is a
 * pure function of (song, beat), including the trail, so seeking or looping
 * never leaves a stale picture behind.
 */
import { Toggle } from '@/components/ui/toggle';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GRUVBOX, QUALITY_COLORS, fgAlpha, trackColor, withAlpha } from './palette';
import { DRUM_CHANNEL, type CompiledSong } from '@play.yaml/core';

interface Props {
  song: CompiledSong | null;
  /** Transport position, in beats. */
  currentBeat: number;
}

/** Beats a released note takes to fade out. */
const FADE_BEATS = 0.5;
/**
 * Chord naming also counts notes released this recently, so an arpeggio (a
 * Bach prelude is one note at a time) still reads as the chord it spells.
 */
const LINGER_BEATS = 1.5;
/** How far back, and how often, the Tonnetz trail looks at the harmony. */
const TRAIL_STEP = 0.5;
const TRAIL_SAMPLES = 8;
const TRAIL_MAX = 4;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CLOCK_LABELS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

interface Note {
  time: number;
  end: number;
  midi: number;
  pc: number;
  track: number;
}

/** Pitched notes of every non-percussion track, sorted by start. */
function pitchedNotes(song: CompiledSong | null): { notes: Note[]; maxDur: number } {
  const notes: Note[] = [];
  let maxDur = 0;
  (song?.tracks ?? []).forEach((t, track) => {
    if (t.channel === DRUM_CHANNEL || t.kit) return;
    for (const n of t.timeline) {
      notes.push({ time: n.time, end: n.time + n.duration, midi: n.midi, pc: ((n.midi % 12) + 12) % 12, track });
      if (n.duration > maxDur) maxDur = n.duration;
    }
  });
  notes.sort((a, b) => a.time - b.time);
  return { notes, maxDur };
}

interface PcState {
  /** 1 while sounding, falling to 0 over FADE_BEATS after release. */
  alpha: number;
  track: number;
}

interface Harmony {
  pcs: (PcState | null)[];
  /** Pitch classes sounding or only just released, lowest note first. */
  held: number[];
  bass: number;
}

/** What sounds at `beat`. Binary search for the window, then a short scan. */
function harmonyAt(notes: Note[], maxDur: number, beat: number): Harmony {
  const pcs: (PcState | null)[] = new Array(12).fill(null);
  const lowest: number[] = new Array(12).fill(Infinity);
  const lo = beat - maxDur - LINGER_BEATS;
  let a = 0;
  let b = notes.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (notes[mid].time < lo) a = mid + 1;
    else b = mid;
  }
  for (let i = a; i < notes.length && notes[i].time <= beat; i++) {
    const n = notes[i];
    let alpha = 0;
    if (n.end > beat) alpha = 1;
    else if (beat - n.end < FADE_BEATS) alpha = 1 - (beat - n.end) / FADE_BEATS;
    if (alpha === 0 && beat - n.end < LINGER_BEATS) {
      if (n.midi < lowest[n.pc]) lowest[n.pc] = n.midi;
      continue;
    }
    if (alpha <= 0) continue;
    const cur = pcs[n.pc];
    if (!cur || alpha > cur.alpha || (alpha === cur.alpha && n.track < cur.track)) {
      pcs[n.pc] = { alpha, track: n.track };
    }
    if (n.midi < lowest[n.pc]) lowest[n.pc] = n.midi;
  }
  const held = [...Array(12).keys()].filter((p) => lowest[p] !== Infinity).sort((x, y) => lowest[x] - lowest[y]);
  return { pcs, held, bass: held[0] ?? -1 };
}

interface Chord {
  root: number;
  quality: string;
  /** Text after the root name: "m", "7", "dim"… */
  suffix: string;
  triad: 'major' | 'minor' | null;
}

const CHORDS: { intervals: number[]; quality: string; suffix: string; triad: 'major' | 'minor' | null }[] = [
  { intervals: [0, 4, 7], quality: 'major', suffix: '', triad: 'major' },
  { intervals: [0, 3, 7], quality: 'minor', suffix: 'm', triad: 'minor' },
  { intervals: [0, 3, 6], quality: 'dim', suffix: 'dim', triad: null },
  { intervals: [0, 4, 8], quality: 'aug', suffix: 'aug', triad: null },
  { intervals: [0, 2, 7], quality: 'sus', suffix: 'sus2', triad: null },
  { intervals: [0, 5, 7], quality: 'sus', suffix: 'sus4', triad: null },
  { intervals: [0, 4, 7, 11], quality: 'major', suffix: 'maj7', triad: 'major' },
  { intervals: [0, 4, 7, 10], quality: 'major', suffix: '7', triad: 'major' },
  { intervals: [0, 3, 7, 10], quality: 'minor', suffix: 'm7', triad: 'minor' },
  { intervals: [0, 3, 7, 11], quality: 'minor', suffix: 'm(maj7)', triad: 'minor' },
  { intervals: [0, 3, 6, 10], quality: 'dim', suffix: 'm7b5', triad: null },
  { intervals: [0, 3, 6, 9], quality: 'dim', suffix: 'dim7', triad: null },
];

/** Names the held pitch classes as a chord, preferring the bass as root. */
function nameChord(held: number[], bass: number): Chord | null {
  if (held.length < 3) return null;
  const set = new Set(held);
  const roots = [bass, ...held.filter((p) => p !== bass)];
  for (const root of roots) {
    for (const c of CHORDS) {
      if (c.intervals.length !== set.size) continue;
      if (c.intervals.every((i) => set.has((root + i) % 12))) {
        return { root, quality: c.quality, suffix: c.suffix, triad: c.triad };
      }
    }
  }
  return null;
}

/** Lattice coordinates → pitch class: +1 step right is a fifth, +1 up-right a major third. */
const latticePc = (i: number, j: number) => (((7 * i + 4 * j) % 12) + 12) % 12;

/** The three lattice vertices of a major or minor triad whose root sits at (i, j). */
function triangleAt(i: number, j: number, minor: boolean): [number, number][] {
  return minor ? [[i, j], [i + 1, j], [i + 1, j - 1]] : [[i, j], [i + 1, j], [i, j + 1]];
}

export default function HarmonyView({ song, currentBeat }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fifths, setFifths] = useState(false);
  const data = useMemo(() => pitchedNotes(song), [song]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (!data.notes.length) {
        ctx.fillStyle = fgAlpha(0.28);
        ctx.font = '13px "Paper Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Nothing to show yet. The score has no pitched notes.', w / 2, h / 2);
        return;
      }

      const now = harmonyAt(data.notes, data.maxDur, currentBeat);
      const chord = nameChord(now.held, now.bass);

      // Side by side when wide, stacked when narrow.
      const wide = w >= h * 1.15;
      const clockBox = wide ? { x: 0, y: 0, w: w / 2, h } : { x: 0, y: 0, w, h: h / 2 };
      const tonnBox = wide ? { x: w / 2, y: 0, w: w / 2, h } : { x: 0, y: h / 2, w, h: h / 2 };

      drawClock(ctx, clockBox, now, chord, fifths);
      drawTonnetz(ctx, tonnBox, data.notes, data.maxDur, currentBeat, now);
    };

    draw();
    // Canvas text falls back until the webfont arrives: draw again once it has.
    let alive = true;
    document.fonts.load('13px "Paper Mono"').then(() => alive && draw());
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [data, currentBeat, fifths]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-stage">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <Toggle
        pressed={fifths}
        onPressedChange={setFifths}
        variant="outline"
        size="sm"
        className="absolute left-3 top-3 h-auto min-w-0 bg-card/80 px-2 py-1 text-[11px] font-normal text-muted-foreground"
      >
        Order: {fifths ? 'circle of fifths' : 'chromatic'}
      </Toggle>
    </div>
  );
}

type Box = { x: number; y: number; w: number; h: number };

function drawClock(ctx: CanvasRenderingContext2D, box: Box, now: Harmony, chord: Chord | null, fifths: boolean) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const R = Math.max(40, Math.min(box.w, box.h) / 2 - 38);
  const pos = (pc: number) => {
    const idx = fifths ? (pc * 7) % 12 : pc;
    const a = -Math.PI / 2 + (idx * Math.PI) / 6;
    return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, a };
  };

  ctx.strokeStyle = fgAlpha(0.08);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  // The polygon: every lit pitch class in clock order, so a chord is a shape.
  const lit = [...Array(12).keys()].filter((p) => now.pcs[p] && now.pcs[p]!.alpha > 0.04);
  if (lit.length >= 2) {
    const ordered = lit.sort((x, y) => pos(x).a - pos(y).a);
    const peak = Math.max(...ordered.map((p) => now.pcs[p]!.alpha));
    const color = QUALITY_COLORS[chord?.quality ?? 'other'] ?? QUALITY_COLORS.other;
    ctx.beginPath();
    ordered.forEach((p, i) => {
      const { x, y } = pos(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = withAlpha(color, 0.22 * peak);
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.85 * peak);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (let pc = 0; pc < 12; pc++) {
    const { x, y } = pos(pc);
    const st = now.pcs[pc];
    const r = 6 + (st ? 5 * st.alpha : 0);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (st) {
      const color = trackColor(st.track);
      ctx.fillStyle = withAlpha(color, 0.35 + 0.65 * st.alpha);
    } else {
      ctx.fillStyle = fgAlpha(0.1);
    }
    ctx.fill();
    ctx.fillStyle = st ? fgAlpha(0.95) : fgAlpha(0.4);
    ctx.font = '11px "Paper Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lx = cx + Math.cos(pos(pc).a) * (R + 24);
    const ly = cy + Math.sin(pos(pc).a) * (R + 24);
    ctx.fillText(CLOCK_LABELS[pc], lx, ly);
  }

  // The name in the middle, or the plain notes when it is not a chord we name.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (now.held.length) {
    const label = chord
      ? SHARP_NAMES[chord.root] + chord.suffix
      : now.held.map((p) => SHARP_NAMES[p]).join(' ');
    ctx.fillStyle = fgAlpha(0.92);
    ctx.font = `600 ${chord ? Math.max(16, R * 0.28) : Math.max(12, R * 0.14)}px "Paper Mono", ui-monospace, monospace`;
    ctx.fillText(label, cx, cy);
  }
}

function drawTonnetz(
  ctx: CanvasRenderingContext2D, box: Box, notes: Note[], maxDur: number, beat: number, now: Harmony,
) {
  const s = Math.max(34, Math.min(box.w / 6.5, box.h / 4.6));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const px = (i: number, j: number) => ({ x: cx + (i + j / 2) * s, y: cy - j * s * (Math.sqrt(3) / 2) });
  const inside = (p: { x: number; y: number }) =>
    p.x > box.x + 14 && p.x < box.x + box.w - 14 && p.y > box.y + 14 && p.y < box.y + box.h - 14;

  // Lattice nodes inside the box. The same pitch class appears many times;
  // that is the point of the picture (it is a torus drawn flat).
  const nodes: { i: number; j: number; x: number; y: number; pc: number }[] = [];
  for (let j = -9; j <= 9; j++) {
    for (let i = -14; i <= 14; i++) {
      const p = px(i, j);
      if (inside(p)) nodes.push({ i, j, ...p, pc: latticePc(i, j) });
    }
  }

  // The trail: the distinct triads of the last few beats, oldest first, each
  // placed on the lattice copy nearest the previous one so the path is short.
  const triads: { root: number; minor: boolean; age: number }[] = [];
  for (let k = TRAIL_SAMPLES; k >= 0; k--) {
    const hm = k === 0 ? now : harmonyAt(notes, maxDur, beat - k * TRAIL_STEP);
    const c = nameChord(hm.held, hm.bass);
    if (!c?.triad) continue;
    const last = triads[triads.length - 1];
    if (last && last.root === c.root && last.minor === (c.triad === 'minor')) {
      last.age = k;
      continue;
    }
    triads.push({ root: c.root, minor: c.triad === 'minor', age: k });
  }
  const recent = triads.slice(-TRAIL_MAX);
  let ref = { x: cx, y: cy };
  const placed = recent.map((t) => {
    let best: { pts: { x: number; y: number }[]; gx: number; gy: number; d: number } | null = null;
    for (const n of nodes) {
      if (n.pc !== t.root) continue;
      const pts = triangleAt(n.i, n.j, t.minor).map(([i, j]) => px(i, j));
      if (!pts.every(inside)) continue;
      const gx = (pts[0].x + pts[1].x + pts[2].x) / 3;
      const gy = (pts[0].y + pts[1].y + pts[2].y) / 3;
      const d = Math.hypot(gx - ref.x, gy - ref.y);
      if (!best || d < best.d) best = { pts, gx, gy, d };
    }
    if (best) ref = { x: best.gx, y: best.gy };
    return { t, best };
  });

  // Faint lattice edges.
  ctx.strokeStyle = fgAlpha(0.07);
  ctx.lineWidth = 1;
  const key = (i: number, j: number) => `${i},${j}`;
  const have = new Set(nodes.map((n) => key(n.i, n.j)));
  ctx.beginPath();
  for (const n of nodes) {
    for (const [di, dj] of [[1, 0], [0, 1], [1, -1]]) {
      if (!have.has(key(n.i + di, n.j + dj))) continue;
      const q = px(n.i + di, n.j + dj);
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(q.x, q.y);
    }
  }
  ctx.stroke();

  // Trail triangles, older ones fainter; the newest is the strongest.
  placed.forEach(({ t, best }, idx) => {
    if (!best) return;
    const fresh = (idx + 1) / placed.length;
    const color = t.minor ? QUALITY_COLORS.minor : QUALITY_COLORS.major;
    ctx.beginPath();
    best.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = withAlpha(color, idx === placed.length - 1 && t.age === 0 ? 0.5 : 0.1 + 0.15 * fresh);
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.25 + 0.5 * fresh);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  // A line through the triangle centres shows the path taken.
  const centres = placed.filter((p) => p.best).map((p) => ({ x: p.best!.gx, y: p.best!.gy }));
  if (centres.length > 1) {
    ctx.strokeStyle = fgAlpha(0.35);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    centres.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Nodes: lit ones carry the track colour and fade with the note.
  ctx.font = '11px "Paper Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const n of nodes) {
    const st = now.pcs[n.pc];
    ctx.beginPath();
    ctx.arc(n.x, n.y, st ? 11 + 3 * st.alpha : 9, 0, Math.PI * 2);
    if (st) {
      const color = trackColor(st.track);
      ctx.fillStyle = withAlpha(color, 0.3 + 0.7 * st.alpha);
    } else {
      ctx.fillStyle = fgAlpha(0.07);
    }
    ctx.fill();
    ctx.fillStyle = st ? GRUVBOX.bg0H : fgAlpha(0.38);
    ctx.fillText(SHARP_NAMES[n.pc], n.x, n.y);
  }
}
