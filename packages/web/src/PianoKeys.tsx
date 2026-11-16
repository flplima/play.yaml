/**
 * PianoKeys.tsx — the keyboard under the piano roll, as DOM and CSS 3D.
 *
 * The canvas above draws the falling notes; this draws the keys they land on.
 * Every semitone owns one column, positioned in percent of the width with the
 * same `(midi - lo) / span` the canvas uses for its own columns, so the two
 * agree at any width without measuring anything. A white key widens into the
 * half columns of black neighbours, which tiles the whites the way a real
 * keyboard does while a black key keeps exactly its column.
 *
 * Keys are built once per pitch range. A key going down is a class and a CSS
 * variable on an existing node, set through `press`, which touches only the
 * keys whose state changed since the last call: no React render per frame.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import './piano-keys.css';

/** Which semitones are black keys, indexed by pitch class. */
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
export const isBlack = (midi: number) => BLACK[((midi % 12) + 12) % 12];

/** Height of the stage in px: what the roll leaves out of its own height. */
export const KEYBOARD_HEIGHT = 112;

export interface KeysApi {
  /** Midi pitch -> hue of the track sounding it. Everything absent is up. */
  press(down: Map<number, number>): void;
}

interface Props {
  lo: number;
  hi: number;
  apiRef: MutableRefObject<KeysApi | null>;
}

export default function PianoKeys({ lo, hi, apiRef }: Props) {
  const nodes = useRef<(HTMLDivElement | null)[]>([]);

  const keys = useMemo(() => {
    const span = Math.max(1, hi - lo + 1);
    const col = 100 / span;
    const out = [];
    for (let m = lo; m <= hi; m++) {
      const black = isBlack(m);
      let left = (m - lo) * col;
      let width = col;
      if (!black) {
        if (m > lo && isBlack(m - 1)) { left -= col / 2; width += col / 2; }
        if (m < hi && isBlack(m + 1)) width += col / 2;
      }
      out.push({ m, black, left, width });
    }
    return out;
  }, [lo, hi]);

  useEffect(() => {
    const downNow = new Set<number>();
    apiRef.current = {
      press(down) {
        for (const m of downNow) {
          if (down.has(m)) continue;
          nodes.current[m - lo]?.classList.remove('down');
          downNow.delete(m);
        }
        for (const [m, hue] of down) {
          const el = nodes.current[m - lo];
          if (!el) continue;
          // The hue is kept after release so the key fades out in its own
          // colour rather than flashing to the default one.
          el.style.setProperty('--hue', String(hue));
          if (!downNow.has(m)) {
            el.classList.add('down');
            downNow.add(m);
          }
        }
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [lo, hi, apiRef]);

  return (
    <div
      className="pk-stage"
      aria-hidden="true"
      style={{
        '--pk-h': `${KEYBOARD_HEIGHT}px`,
        '--pk-plane-h': '104px',
        '--pk-depth': '14px',
        '--pk-lift': '10px',
      } as React.CSSProperties}
    >
      <div className="pk-plane">
        {keys.map((k) => (
          <div
            key={k.m}
            ref={(el) => { nodes.current[k.m - lo] = el; }}
            className={k.black ? 'pk-key pk-black' : 'pk-key'}
            style={{ left: `${k.left}%`, width: `${k.width}%` }}
          >
            <div className="pk-top" />
            <div className="pk-front" />
          </div>
        ))}
      </div>
    </div>
  );
}
