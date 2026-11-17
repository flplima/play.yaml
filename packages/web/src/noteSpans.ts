import {
  divideByWeight, expandSections, isMarkToken, isRestToken, measureToBeats, occupiesBar, parseYaml,
  peelSuffix, playMeasureEntries, tokenSpans,
} from '@play.yaml/core';
import type { TrackNode } from '@play.yaml/core';

/** A token's character range in the document and its time span in beats. */
export interface NoteSpan {
  from: number;
  to: number;
  startBeat: number;
  endBeat: number;
  /** 'beat' = a top-level measure token; 'note' = an element inside a group. */
  kind: 'beat' | 'note';
}

/**
 * Recurse into a {} group, emitting a 'note' span for each leaf element
 * (notes and chords) at its subdivided time. Intermediate nested groups are
 * traversed but not emitted — the top-level 'beat' span already covers them.
 */
function emitGroupSpans(text: string, from: number, startBeat: number, endBeat: number, spans: NoteSpan[]): void {
  const { core } = peelSuffix(text);
  if (!(core.startsWith('{') && core.endsWith('}'))) return;
  const inner = tokenSpans(core.slice(1, -1));
  const slots = divideByWeight(inner.map((el) => el.text), endBeat - startBeat);
  inner.forEach((el, i) => {
    if (isRestToken(el.text)) return;
    const s = startBeat + slots[i].offset;
    const e = s + slots[i].span;
    const at = from + 1 + el.from;
    if (el.text.startsWith('{')) emitGroupSpans(el.text, at, s, e, spans);
    else spans.push({ from: at, to: from + 1 + el.to, startBeat: s, endBeat: e, kind: 'note' });
  });
}

/**
 * Map every token of every track's measures back to its character range in
 * the YAML source, so the editor can highlight what is sounding. Top-level
 * tokens become 'beat' spans; elements inside {} groups additionally get
 * finer 'note' spans. Measure strings are located by scanning the raw text
 * in document order, which sidesteps needing YAML source positions.
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
        tokens.forEach((tok, i) => {
          if (isRestToken(tok.text)) return;
          const startBeat = (wait + mi) * measureBeats + slots[i].offset;
          const endBeat = startBeat + slots[i].span;
          spans.push({ from: idx + tok.from, to: idx + tok.to, startBeat, endBeat, kind: 'beat' });
          emitGroupSpans(tok.text, idx + tok.from, startBeat, endBeat, spans);
        });
      }
    }

    if (node.tracks && typeof node.tracks === 'object') {
      for (const child of Object.values(node.tracks)) walk(child, measure, wait);
    }
  };

  walk(doc, doc.measure);
  return spans;
}
