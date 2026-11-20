/**
 * PianoKeys.tsx — the keyboard under the piano roll, as DOM and CSS 3D.
 *
 * The canvas above draws the falling notes; this draws the keys they land on.
 * Every semitone owns one column, positioned in percent of the width with the
 * same `(midi - lo) / span` the canvas uses for its own columns, so the two
 * agree at any width without measuring anything. A black key keeps exactly
 * its column. The seven white keys of an octave share its twelve columns
 * equally, 12/7 of a column each, as on a real keyboard: every white key is
 * the same width, and each black key still sits over the seam between two.
 * The outermost white keys may run past the edge, where the stage cuts them.
 *
 * Keys are built once per pitch range. A key going down is a class and a CSS
 * variable on an existing node, set through `press`, which touches only the
 * keys whose state changed since the last call: no React render per frame.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import './piano-keys.css';

/** Which semitones are black keys, indexed by pitch class. */
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
/** A white key's place among the octave's seven (C = 0 … B = 6), by pitch class. */
const WHITE_INDEX = [0, -1, 1, -1, 2, 3, -1, 4, -1, 5, -1, 6];
export const isBlack = (midi: number) => BLACK[((midi % 12) + 12) % 12];

/** Height of the stage in px: what the roll leaves out of its own height. */
export const KEYBOARD_HEIGHT = 112;

export interface KeysApi {
  /** Midi pitch -> colour of the track sounding it. Everything absent is up. */
  press(down: Map<number, string>): void;
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
    const white = (col * 12) / 7;
    for (let m = lo; m <= hi; m++) {
      const black = isBlack(m);
      const pc = ((m % 12) + 12) % 12;
      const left = black ? (m - lo) * col : (m - pc - lo) * col + WHITE_INDEX[pc] * white;
      out.push({ m, black, left, width: black ? col : white });
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
        for (const [m, color] of down) {
          const el = nodes.current[m - lo];
          if (!el) continue;
          // The colour is kept after release so the key fades out in its own
          // colour rather than flashing to the default one.
          el.style.setProperty('--track', color);
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
