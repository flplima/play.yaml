/**
 * PianoRoll.tsx — the score as falling notes.
 *
 * The editor shows what a score *says*; this shows what it does. Notes fall
 * toward a keyboard at the bottom and land on the beat they sound, the way
 * Synthesia and every game descended from it draws music — which is the one
 * visualisation most people can already read without being taught.
 *
 * Drawn on a canvas rather than as DOM nodes: a busy score is thousands of
 * rectangles moving every frame, and that is a repaint, not a reconciliation.
 */
import { useEffect, useRef } from 'react';
import type { CompiledSong } from '@play.yaml/core';

interface Props {
  song: CompiledSong | null;
  /** Transport position. Notes are placed relative to it. */
  currentBeat: number;
  playing: boolean;
  /** Beats of music visible above the keyboard — the look-ahead. */
  lookAhead?: number;
}

/** Which semitones are black keys, indexed by pitch class. */
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

/**
 * One colour per track, walked in order. Chosen to stay distinct on a dark
 * background and to survive being drawn small — a track is identified by hue
 * alone, so the hues are spaced rather than pretty.
 */
const TRACK_HUES = [265, 190, 42, 330, 150, 15, 220, 95];

export default function PianoRoll({ song, currentBeat, playing, lookAhead = 8 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Nothing to show yet — the score has no notes.', w / 2, h / 2);
        return;
      }

      // Pitch span: the score's own range, padded to a couple of semitones so
      // the outermost notes are not flush against the edge.
      let lo = Infinity;
      let hi = -Infinity;
      for (const n of notes) {
        if (n.midi < lo) lo = n.midi;
        if (n.midi > hi) hi = n.midi;
      }
      lo = Math.max(0, lo - 2);
      hi = Math.min(127, hi + 2);
      const span = Math.max(1, hi - lo + 1);
      const keyW = w / span;

      const keyboardH = Math.min(72, Math.max(40, h * 0.16));
      const rollH = h - keyboardH;
      /** Beats → pixels. The keyboard is "now"; time runs upward. */
      const pxPerBeat = rollH / lookAhead;
      const xOf = (midi: number) => (midi - lo) * keyW;

      // ── the keyboard ────────────────────────────────────────────────────
      for (let m = lo; m <= hi; m++) {
        const black = BLACK[((m % 12) + 12) % 12];
        ctx.fillStyle = black ? '#15161c' : '#e9e9ee';
        ctx.fillRect(xOf(m), rollH, keyW, keyboardH);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(xOf(m) + 0.5, rollH + 0.5, keyW - 1, keyboardH - 1);
      }

      // Lane shading: the black-key columns, so pitch is readable while notes
      // are in flight rather than only when they land.
      for (let m = lo; m <= hi; m++) {
        if (!BLACK[((m % 12) + 12) % 12]) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(xOf(m), 0, keyW, rollH);
      }

      // ── beat lines ──────────────────────────────────────────────────────
      const firstBeat = Math.floor(currentBeat);
      for (let b = firstBeat; b <= currentBeat + lookAhead; b++) {
        const y = rollH - (b - currentBeat) * pxPerBeat;
        if (y < 0 || y > rollH) continue;
        const bar = b % 4 === 0;
        ctx.strokeStyle = bar ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }

      // ── the notes ───────────────────────────────────────────────────────
      const sounding: number[] = [];
      for (const n of notes) {
        const end = n.time + n.duration;
        if (end < currentBeat - 0.5 || n.time > currentBeat + lookAhead) continue;
        const top = rollH - (end - currentBeat) * pxPerBeat;
        const bottom = rollH - (n.time - currentBeat) * pxPerBeat;
        const height = Math.max(2, bottom - top);
        const hue = TRACK_HUES[n.track % TRACK_HUES.length];
        const live = n.time <= currentBeat && end > currentBeat;
        if (live) sounding.push(n.midi);
        // A note being played is lit; one still falling is dimmer, and the
        // dimming follows velocity so a phrase's shape is visible before it
        // arrives rather than only when it sounds.
        const light = live ? 68 : 34 + (n.velocity / 127) * 18;
        ctx.fillStyle = `hsl(${hue} 70% ${light}%)`;
        const x = xOf(n.midi) + keyW * 0.08;
        const nw = Math.max(1.5, keyW * 0.84);
        const r = Math.min(3, nw / 2, height / 2);
        ctx.beginPath();
        ctx.roundRect(x, Math.max(-height, top), nw, height, r);
        ctx.fill();
        if (live) {
          ctx.strokeStyle = `hsl(${hue} 90% 82%)`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // ── keys that are down ──────────────────────────────────────────────
      for (const m of sounding) {
        if (m < lo || m > hi) continue;
        const black = BLACK[((m % 12) + 12) % 12];
        ctx.fillStyle = black ? 'hsl(265 70% 52%)' : 'hsl(265 80% 68%)';
        ctx.fillRect(xOf(m), rollH, keyW, keyboardH);
      }

      // The strike line: where a note becomes a sound.
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, rollH);
      ctx.lineTo(w, rollH);
      ctx.stroke();
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [song, currentBeat, playing, lookAhead]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#0b0c10]">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
