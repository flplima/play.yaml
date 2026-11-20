/**
 * PianoRoll.tsx — the score as falling notes.
 *
 * The editor shows what a score *says*; this shows what it does. Notes fall
 * toward a keyboard at the bottom and land on the beat they sound, the way
 * Synthesia and every game descended from it draws music — which is the one
 * visualisation most people can already read without being taught.
 *
 * The notes are drawn on a canvas rather than as DOM nodes: a busy score is
 * thousands of rectangles moving every frame, and that is a repaint, not a
 * reconciliation. The keyboard is the opposite case, about eighty nodes that
 * change rarely, so it is DOM with CSS 3D (PianoKeys.tsx).
 */
import { useEffect, useMemo, useRef } from 'react';
import { CC, beatsToSeconds, tempoSegments } from '@play.yaml/core';
import type { CompiledSong, ControlEvent, TempoSegment } from '@play.yaml/core';
import { GRUVBOX, fgAlpha, trackColor, withAlpha } from './palette';
import PianoKeys, { isBlack, type KeysApi } from './PianoKeys';

interface Props {
  song: CompiledSong | null;
  /** Transport position. Notes are placed relative to it. */
  currentBeat: number;
}

/** Beats of music visible above the keyboard. */
const LOOK_AHEAD = 8;

// ── tracks that bend: vibrato and pressure ───────────────────────────────

/** One controller's values over a track, in beats. */
interface Curve {
  times: number[];
  values: number[];
}

/**
 * How a track's notes change shape while they ring. A note sways with the
 * vibrato, at its depth and rate, and narrows as the pressure drops: the
 * expression, breath and bow pressure it is played with. A track with none of
 * these controls (a piano) keeps plain bars.
 */
interface Shape {
  vibrato: Curve | null;
  rate: Curve | null;
  pressure: Curve[];
}

function curveOf(controls: ControlEvent[], cc: number): Curve | null {
  const events = controls.filter((c) => c.cc === cc).sort((a, b) => a.time - b.time);
  if (!events.length) return null;
  return { times: events.map((e) => e.time), values: events.map((e) => e.value / 127) };
}

/**
 * A curve's value at `beat`, 0 to 1. A ramp compiles to small steps, so
 * steps up to a beat apart are joined into a line; a longer gap is a held
 * value that changes at once, the way `pianissimo` after a swell does.
 */
function valueAt(c: Curve, beat: number, before = 1): number {
  const { times, values } = c;
  if (beat < times[0]) return before;
  let i = times.length - 1;
  while (i > 0 && times[i] > beat) i--;
  const next = i + 1;
  if (next < times.length && times[next] - times[i] <= 1) {
    const f = (beat - times[i]) / (times[next] - times[i]);
    return values[i] + (values[next] - values[i]) * f;
  }
  return values[i];
}

function shapeOf(controls: ControlEvent[]): Shape | null {
  const vibrato = curveOf(controls, CC.vibrato);
  const pressure = [CC.expression, CC.breath, CC.pressure]
    .map((cc) => curveOf(controls, cc))
    .filter((c): c is Curve => c !== null);
  if (!vibrato && !pressure.length) return null;
  return { vibrato, rate: curveOf(controls, CC.vibratoRate), pressure };
}

/** The synth's vibrato rate for a CC 76 value (core's bus): 3.2 to 7.7 Hz, 5.2 unset. */
const vibratoHz = (shape: Shape, beat: number) => (shape.rate ? 3.2 + 4.5 * valueAt(shape.rate, beat) : 5.2);

/**
 * The pitch span the roll and the keyboard share: the score's own range,
 * padded a couple of semitones so the outermost notes are not flush against
 * the edge. One owner, so the canvas columns and the keys cannot disagree.
 */
function pitchRange(song: CompiledSong | null): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of song?.tracks ?? []) {
    for (const n of t.timeline) {
      if (n.midi < lo) lo = n.midi;
      if (n.midi > hi) hi = n.midi;
    }
  }
  if (lo > hi) return { lo: 48, hi: 84 };
  return { lo: Math.max(0, lo - 2), hi: Math.min(127, hi + 2) };
}

export default function PianoRoll({ song, currentBeat }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const keysRef = useRef<KeysApi | null>(null);
  const { lo, hi } = useMemo(() => pitchRange(song), [song]);
  const shapes = useMemo(() => (song?.tracks ?? []).map((t) => shapeOf(t.controls ?? [])), [song]);
  const segments = useMemo<TempoSegment[]>(() => tempoSegments(song?.bpm ?? 120, song?.tempoMap ?? []), [song]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Redraw on resize as well as on the beat, so the roll survives the panel
    // being toggled or the window changing shape.
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

      const tracks = song?.tracks ?? [];
      const notes = tracks.flatMap((t, i) => t.timeline.map((n) => ({ ...n, track: i })));
      if (!notes.length) {
        keysRef.current?.press(new Map());
        ctx.fillStyle = fgAlpha(0.35);
        ctx.font = '13px "Paper Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Nothing to show yet — the score has no notes.', w / 2, h / 2);
        return;
      }

      const span = Math.max(1, hi - lo + 1);
      const keyW = w / span;

      const rollH = h;
      const pxPerBeat = rollH / LOOK_AHEAD;
      const xOf = (midi: number) => (midi - lo) * keyW;

      // Lane shading: the black-key columns, so pitch is readable while notes
      // are in flight rather than only when they land.
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) continue;
        ctx.fillStyle = fgAlpha(0.04);
        ctx.fillRect(xOf(m), 0, keyW, rollH);
      }

      // ── beat lines ──────────────────────────────────────────────────────
      const firstBeat = Math.floor(currentBeat);
      const measureBeats = Math.max(1, Math.round(song?.measureBeats ?? 4));
      for (let b = firstBeat; b <= currentBeat + LOOK_AHEAD; b++) {
        const y = rollH - (b - currentBeat) * pxPerBeat;
        if (y < 0 || y > rollH) continue;
        const bar = b % measureBeats === 0;
        ctx.strokeStyle = bar ? fgAlpha(0.18) : fgAlpha(0.07);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }

      // ── the notes ───────────────────────────────────────────────────────

      // A bending note's outline, from its start to its end: the centre sways
      // with the vibrato and the width follows the pressure. The phase runs
      // from the note's own start, in seconds, so the sway keeps the rate you
      // hear through tempo changes.
      const traceBend = (start: number, end: number, cx: number, half: number, shape: Shape) => {
        const step = 1 / pxPerBeat; // a point a pixel: a 5 Hz sway is ~12 px a cycle
        const from = Math.max(start, currentBeat - 0.5);
        const to = Math.min(end, currentBeat + LOOK_AHEAD);
        const left: [number, number][] = [];
        const right: [number, number][] = [];
        let phase = 0;
        let prevSec = beatsToSeconds(segments, start);
        for (let b = start; ; b = Math.min(to, b + step)) {
          const sec = beatsToSeconds(segments, b);
          phase += 2 * Math.PI * vibratoHz(shape, b) * (sec - prevSec);
          prevSec = sec;
          if (b >= from) {
            const depth = shape.vibrato ? valueAt(shape.vibrato, b, 0) : 0;
            const sway = keyW * 0.22 * depth * Math.sin(phase);
            const p = shape.pressure.reduce((acc, c) => acc * valueAt(c, b), 1);
            const w = Math.max(0.75, half * (0.2 + 0.8 * p * p));
            const y = rollH - (b - currentBeat) * pxPerBeat;
            left.push([cx + sway - w, y]);
            right.push([cx + sway + w, y]);
          }
          if (b >= to) break;
        }
        if (!left.length) return;
        ctx.moveTo(left[0][0], left[0][1]);
        for (const [px, py] of left) ctx.lineTo(px, py);
        for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
        ctx.closePath();
      };

      const sounding = new Map<number, string>();
      for (const n of notes) {
        const end = n.time + n.duration;
        if (end < currentBeat - 0.5 || n.time > currentBeat + LOOK_AHEAD) continue;
        const top = rollH - (end - currentBeat) * pxPerBeat;
        const bottom = rollH - (n.time - currentBeat) * pxPerBeat;
        const height = Math.max(2, bottom - top);
        const color = trackColor(n.track);
        const live = n.time <= currentBeat && end > currentBeat;
        if (live) sounding.set(n.midi, color);
        // A note being played is solid; one still falling is fainter, and the
        // dimming follows velocity so a phrase's shape is visible before it
        // arrives rather than only when it sounds. A track that bends is drawn
        // at 80%, so the notes it passes over stay visible through it.
        const shape = shapes[n.track];
        const alpha = (live ? 1 : 0.4 + (n.velocity / 127) * 0.3) * (shape ? 0.8 : 1);
        ctx.fillStyle = withAlpha(color, alpha);
        const x = xOf(n.midi) + keyW * 0.08;
        const nw = Math.max(1.5, keyW * 0.84);
        ctx.beginPath();
        if (shape) {
          traceBend(n.time, end, x + nw / 2, nw / 2, shape);
        } else {
          const r = Math.min(3, nw / 2, height / 2);
          ctx.roundRect(x, Math.max(-height, top), nw, height, r);
        }
        ctx.fill();
        if (live) {
          ctx.strokeStyle = GRUVBOX.fg;
          ctx.lineWidth = shape ? 1 : 1.5;
          ctx.stroke();
        }
      }

      keysRef.current?.press(sounding);

      // The strike line: where a note becomes a sound.
      ctx.strokeStyle = fgAlpha(0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, rollH);
      ctx.lineTo(w, rollH);
      ctx.stroke();
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
  }, [song, currentBeat, lo, hi, shapes, segments]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-stage">
      {/* The canvas takes whatever height the keyboard leaves, so the strike
          line is always exactly where the keys begin. */}
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      </div>
      <PianoKeys lo={lo} hi={hi} apiRef={keysRef} />
    </div>
  );
}
