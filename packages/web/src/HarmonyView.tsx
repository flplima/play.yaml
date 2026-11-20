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
 * The chord in the middle, and the strip of the whole progression along the
 * bottom, come from chords.ts: a bar at a time, read from the accompaniment,
 * so an arpeggio or a passing note in the tune still names its chord.
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
import { chordLabel, chordProgression, exactChord, spanIndexAt, spelling, type Chord, type ChordSpan } from './chords';

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
/** How many of the last chords the Tonnetz trail draws. */
const TRAIL_MAX = 4;
/** The progression strip: its height, and how wide a beat is on it. */
const STRIP_H = 44;
const STRIP_PX_PER_BEAT = 30;
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
  const progression = useMemo(() => chordProgression(song), [song]);
  const names = useMemo(() => spelling(song), [song]);

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
      // The bar's chord; between the song's chords, whatever the notes spell.
      const idx = spanIndexAt(progression, currentBeat);
      const span = idx >= 0 && progression[idx].end > currentBeat ? progression[idx] : null;
      const chord = span ? span.chord : exactChord(now.held, now.bass);

      // Side by side when wide, stacked when narrow, the strip under both.
      const ch = progression.length ? h - STRIP_H : h;
      const wide = w >= ch * 1.15;
      const clockBox = wide ? { x: 0, y: 0, w: w / 2, h: ch } : { x: 0, y: 0, w, h: ch / 2 };
      const tonnBox = wide ? { x: w / 2, y: 0, w: w / 2, h: ch } : { x: 0, y: ch / 2, w, h: ch / 2 };

      drawClock(ctx, clockBox, now, chord, fifths, names);
      drawTonnetz(ctx, tonnBox, progression, span ? idx : -1, now, names);
      if (progression.length) drawStrip(ctx, { x: 0, y: ch, w, h: STRIP_H }, progression, currentBeat, names);
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
  }, [data, progression, names, currentBeat, fifths]);

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

function drawClock(
  ctx: CanvasRenderingContext2D, box: Box, now: Harmony, chord: Chord | null, fifths: boolean, names: string[],
) {
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

  // The polygon: the chord's tones in clock order, so a chord is a shape even
  // when an arpeggio sounds one of them at a time. With no chord named, the
  // lit pitch classes make the shape instead.
  const lit = [...Array(12).keys()].filter((p) => now.pcs[p] && now.pcs[p]!.alpha > 0.04);
  const shape = chord ? [...chord.tones] : lit;
  if (shape.length >= 2) {
    const ordered = shape.sort((x, y) => pos(x).a - pos(y).a);
    const peak = chord ? 1 : Math.max(...ordered.map((p) => now.pcs[p]!.alpha));
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
    const tone = chord?.tones.includes(pc) ?? false;
    if (st) {
      const color = trackColor(st.track);
      ctx.fillStyle = withAlpha(color, 0.35 + 0.65 * st.alpha);
    } else {
      ctx.fillStyle = tone ? withAlpha(QUALITY_COLORS[chord!.quality] ?? QUALITY_COLORS.other, 0.45) : fgAlpha(0.1);
    }
    ctx.fill();
    ctx.fillStyle = st || tone ? fgAlpha(0.95) : fgAlpha(0.4);
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
    const label = chord ? chordLabel(chord, names) : now.held.map((p) => names[p]).join(' ');
    ctx.fillStyle = fgAlpha(0.92);
    ctx.font = `600 ${chord ? Math.max(16, R * 0.28) : Math.max(12, R * 0.14)}px "Paper Mono", ui-monospace, monospace`;
    ctx.fillText(label, cx, cy);
  }
}

function drawTonnetz(
  ctx: CanvasRenderingContext2D, box: Box, progression: ChordSpan[], current: number, now: Harmony, names: string[],
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

  // The trail: the last few triads of the progression, oldest first, each
  // placed on the lattice copy nearest the previous one so the path is short.
  // A seventh chord counts as its triad; a diminished one has no triangle.
  const triads: { root: number; minor: boolean; age: number }[] = [];
  for (let k = Math.max(0, current - 3 * TRAIL_MAX); current >= 0 && k <= current; k++) {
    const c = progression[k].chord;
    if (!c.triad) continue;
    const last = triads[triads.length - 1];
    if (last && last.root === c.root && last.minor === (c.triad === 'minor')) {
      last.age = current - k;
      continue;
    }
    triads.push({ root: c.root, minor: c.triad === 'minor', age: current - k });
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
    ctx.fillText(names[n.pc], n.x, n.y);
  }
}

/**
 * The whole progression as a tape under the playhead: one cell per chord, as
 * wide as it lasts, sliding left as the song plays. The cell under the line is
 * the chord in the middle of the clock.
 */
function drawStrip(ctx: CanvasRenderingContext2D, box: Box, progression: ChordSpan[], beat: number, names: string[]) {
  const mid = box.x + box.w / 2;
  ctx.fillStyle = fgAlpha(0.03);
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.font = '600 12px "Paper Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const sp of progression) {
    const x0 = mid + (sp.start - beat) * STRIP_PX_PER_BEAT;
    const x1 = mid + (sp.end - beat) * STRIP_PX_PER_BEAT;
    if (x1 < box.x || x0 > box.x + box.w) continue;
    const now = sp.start <= beat && beat < sp.end;
    const past = sp.end <= beat;
    const color = QUALITY_COLORS[sp.chord.quality] ?? QUALITY_COLORS.other;
    ctx.beginPath();
    ctx.roundRect(x0 + 2, box.y + 8, Math.max(1, x1 - x0 - 4), box.h - 14, 4);
    ctx.fillStyle = withAlpha(color, now ? 0.32 : past ? 0.06 : 0.12);
    ctx.fill();
    if (now) {
      ctx.strokeStyle = withAlpha(color, 0.9);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = now ? fgAlpha(0.95) : fgAlpha(past ? 0.3 : 0.6);
    ctx.fillText(chordLabel(sp.chord, names), (x0 + x1) / 2, box.y + 1 + box.h / 2, Math.max(8, x1 - x0 - 8));
  }
  // The playhead.
  ctx.strokeStyle = fgAlpha(0.7);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mid, box.y + 4);
  ctx.lineTo(mid, box.y + box.h - 2);
  ctx.stroke();
}
