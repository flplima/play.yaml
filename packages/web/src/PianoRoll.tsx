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
import type { CompiledSong } from '@play.yaml/core';
import PianoKeys, { isBlack, type KeysApi } from './PianoKeys';

interface Props {
  song: CompiledSong | null;
  /** Transport position. Notes are placed relative to it. */
  currentBeat: number;
}

/** Beats of music visible above the keyboard. */
const LOOK_AHEAD = 8;

/**
 * One colour per track, walked in order. Chosen to stay distinct on a dark
 * background and to survive being drawn small — a track is identified by hue
 * alone, so the hues are spaced rather than pretty.
 */
const TRACK_HUES = [265, 190, 42, 330, 150, 15, 220, 95];

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
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
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
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(xOf(m), 0, keyW, rollH);
      }

      // ── beat lines ──────────────────────────────────────────────────────
      const firstBeat = Math.floor(currentBeat);
      const measureBeats = Math.max(1, Math.round(song?.measureBeats ?? 4));
      for (let b = firstBeat; b <= currentBeat + LOOK_AHEAD; b++) {
        const y = rollH - (b - currentBeat) * pxPerBeat;
        if (y < 0 || y > rollH) continue;
        const bar = b % measureBeats === 0;
        ctx.strokeStyle = bar ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }

      // ── the notes ───────────────────────────────────────────────────────
      const sounding = new Map<number, number>();
      for (const n of notes) {
        const end = n.time + n.duration;
        if (end < currentBeat - 0.5 || n.time > currentBeat + LOOK_AHEAD) continue;
        const top = rollH - (end - currentBeat) * pxPerBeat;
        const bottom = rollH - (n.time - currentBeat) * pxPerBeat;
        const height = Math.max(2, bottom - top);
        const hue = TRACK_HUES[n.track % TRACK_HUES.length];
        const live = n.time <= currentBeat && end > currentBeat;
        if (live) sounding.set(n.midi, hue);
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

      keysRef.current?.press(sounding);

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
  }, [song, currentBeat, lo, hi]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0b0c10]">
      {/* The canvas takes whatever height the keyboard leaves, so the strike
          line is always exactly where the keys begin. */}
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      </div>
      <PianoKeys lo={lo} hi={hi} apiRef={keysRef} />
    </div>
  );
}
