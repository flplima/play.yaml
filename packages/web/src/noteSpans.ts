import {
  HOLD, divideByWeight, expandSections, isMarkToken, isRestToken, measureToBeats, occupiesBar, parseYaml,
  peelSuffix, playMeasureEntries, tokenSpans,
} from '@play.yaml/core';
import type { TrackNode } from '@play.yaml/core';

/** A character range in the document and its time span in beats. */
export interface NoteSpan {
  from: number;
  to: number;
  startBeat: number;
  endBeat: number;
  /**
   * 'beat' = a top-level {} group, for as long as it plays; 'note' = a note
   * or chord with the `_` holds after it, `g _ _` in `g _ _ e`.
   */
  kind: 'beat' | 'note';
}

/** One token that takes time: a note (or chord), a hold or a rest. */
interface Leaf {
  from: number;
  to: number;
  startBeat: number;
  endBeat: number;
  type: 'note' | 'hold' | 'rest';
}

function leafType(token: string): Leaf['type'] {
  if (isRestToken(token)) return 'rest';
  return peelSuffix(token).core === HOLD ? 'hold' : 'note';
}

const isGroup = (token: string) => peelSuffix(token).core.startsWith('{');

/** The leaves of a {} group, in time order, at their subdivided beats. */
function groupLeaves(text: string, from: number, startBeat: number, endBeat: number, out: Leaf[]): void {
  const { core } = peelSuffix(text);
  if (!core.endsWith('}')) return;
  const inner = tokenSpans(core.slice(1, -1));
  const slots = divideByWeight(inner.map((el) => el.text), endBeat - startBeat);
  inner.forEach((el, i) => {
    const s = startBeat + slots[i].offset;
    const e = s + slots[i].span;
    const at = from + 1 + el.from;
    if (isGroup(el.text)) groupLeaves(el.text, at, s, e, out);
    else out.push({ from: at, to: from + 1 + el.to, startBeat: s, endBeat: e, type: leafType(el.text) });
  });
}

/**
 * Map every token of every track's measures back to its character range in
 * the YAML source, so the editor can highlight what is sounding: each note
 * with its holds as a 'note' span, and each top-level {} group as a 'beat'
 * span. Measure strings are located by scanning the raw text in document
 * order, which sidesteps needing YAML source positions.
 */
export function buildNoteSpans(text: string): NoteSpan[] {
  let doc: TrackNode;
  try {
    // Sections documents expand to per-track numbered plays, so the measure
    // slots below line up with the compiled beats.
    doc = expandSections(parseYaml(text)).doc;
  } catch {
    return [];
  }
  if (!doc || typeof doc !== 'object') return [];

  const spans: NoteSpan[] = [];
  let cursor = 0;

  const walk = (node: TrackNode, inheritedMeasure: string | number | undefined, waited = 0) => {
    if (!node || typeof node !== 'object') return;
    const measure = node.measure ?? inheritedMeasure;
    const wait = waited + (typeof node.wait === 'number' ? node.wait : 0);

    if (node.play != null) {
      // Whether a note is ringing at the end of the last bar, for a `_` that
      // opens the next one.
      let sounding = false;
      let measureBeats: number;
      try {
        measureBeats = measureToBeats(measure);
      } catch {
        measureBeats = measureToBeats(undefined);
      }

      for (const { text: m, index: mi } of playMeasureEntries(node.play)) {
        if (!occupiesBar(m)) continue;
        let idx = text.indexOf(m, cursor);
        if (idx === -1) idx = text.indexOf(m); // e.g. play: declared after tracks:
        if (idx === -1) continue;
        cursor = idx + m.length;

        const tokens = tokenSpans(m).filter((t) => !isMarkToken(t.text));
        const slots = divideByWeight(tokens.map((t) => t.text), measureBeats);
        const leaves: Leaf[] = [];
        tokens.forEach((tok, i) => {
          const startBeat = (wait + mi) * measureBeats + slots[i].offset;
          const endBeat = startBeat + slots[i].span;
          const from = idx + tok.from;
          if (isGroup(tok.text)) {
            spans.push({ from, to: idx + tok.to, startBeat, endBeat, kind: 'beat' });
            groupLeaves(tok.text, from, startBeat, endBeat, leaves);
          } else {
            leaves.push({ from, to: idx + tok.to, startBeat, endBeat, type: leafType(tok.text) });
          }
        });

        // A note and the holds after it are one span. A bar that opens on `_`
        // carries the last bar's note on: that is a span of its own, since
        // the two halves sit on different lines.
        let held: NoteSpan | null = null;
        const close = () => {
          if (held) spans.push(held);
          held = null;
        };
        for (const leaf of leaves) {
          if (leaf.type === 'note') {
            close();
            held = { from: leaf.from, to: leaf.to, startBeat: leaf.startBeat, endBeat: leaf.endBeat, kind: 'note' };
            sounding = true;
          } else if (leaf.type === 'hold' && sounding) {
            if (held) {
              held.to = leaf.to;
              held.endBeat = leaf.endBeat;
            } else {
              held = { from: leaf.from, to: leaf.to, startBeat: leaf.startBeat, endBeat: leaf.endBeat, kind: 'note' };
            }
          } else {
            close();
            sounding = false;
          }
        }
        close();
      }
    }

    if (node.tracks && typeof node.tracks === 'object') {
      for (const child of Object.values(node.tracks)) walk(child, measure, wait);
    }
  };

  walk(doc, doc.measure);
  return spans;
}
