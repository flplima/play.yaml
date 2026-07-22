import { expandSections, parseYaml, playMeasureEntries, measureToBeats, tokenWeight } from '@play.yaml/core';
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

interface Element {
  text: string;
  from: number; // absolute offset in the document
  to: number;
}

/** Is this element an inline mark (`||…||` set or `==…==` scale) — no time slot? */
function isMarkElement(text: string): boolean {
  return text.startsWith('||') || text.startsWith('==');
}

/** Is this element a rest (a bare `~`, possibly duration-weighted `~:`)? */
function isRestElement(text: string): boolean {
  if (text === '~' || /^~[<>:.]+$/.test(text)) return true;
  const suffix = /([<>~:.]+)$/.exec(text);
  const core = suffix && suffix[1].length < text.length ? text.slice(0, -suffix[1].length) : text;
  return core === '~';
}

/**
 * Split on whitespace at bracket depth 0, keeping absolute offsets. A `||…||`
 * set directive or `==…==` scale mark is one element regardless of the
 * spaces inside it.
 */
function elementsWithOffsets(text: string, baseOffset: number): Element[] {
  const out: Element[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : ' ';
    const fence = ch === '|' && text[i + 1] === '|' ? '||' : ch === '=' && text[i + 1] === '=' ? '==' : null;
    if (depth === 0 && start === -1 && fence) {
      const close = text.indexOf(fence, i + 2);
      const end = close === -1 ? text.length : close + 2;
      out.push({ text: text.slice(i, end), from: baseOffset + i, to: baseOffset + end });
      i = end - 1;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    const isSpace = /\s/.test(ch);
    if (!isSpace && start === -1) {
      start = i;
    } else if (isSpace && depth === 0 && start !== -1) {
      out.push({ text: text.slice(start, i), from: baseOffset + start, to: baseOffset + i });
      start = -1;
    }
  }
  return out;
}

/**
 * Recurse into a {} group, emitting a 'note' span for each leaf element
 * (notes and chords) at its subdivided time. Intermediate nested groups are
 * traversed but not emitted — the top-level 'beat' span already covers them.
 */
function emitGroupSpans(token: Element, startBeat: number, endBeat: number, spans: NoteSpan[]): void {
  const text = token.text.replace(/([<>~:.]+)$/, (m) => (m.length < token.text.length ? '' : m));
  if (!(text.startsWith('{') && text.endsWith('}'))) return;
  const inner = elementsWithOffsets(text.slice(1, -1), token.from + 1);
  if (inner.length === 0) return;
  const total = inner.reduce((sum, el) => sum + tokenWeight(el.text), 0) || 1;
  let pos = startBeat;
  inner.forEach((el) => {
    const step = ((endBeat - startBeat) * tokenWeight(el.text)) / total;
    const s = pos;
    pos += step;
    if (isRestElement(el.text)) return;
    if (el.text.startsWith('{')) {
      emitGroupSpans(el, s, s + step, spans);
    } else {
      spans.push({ from: el.from, to: el.to, startBeat: s, endBeat: s + step, kind: 'note' });
    }
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

  const walk = (node: TrackNode, inheritedMeasure: string | number | undefined) => {
    if (!node || typeof node !== 'object') return;
    const measure = node.measure ?? inheritedMeasure;

    if (node.play != null) {
      let measureBeats = 4;
      try {
        measureBeats = measureToBeats(measure);
      } catch {
        // Invalid measure signature — keep the 4-beat default for spans.
      }

      for (const { text: m, index: mi } of playMeasureEntries(node.play)) {
        let idx = text.indexOf(m, cursor);
        if (idx === -1) idx = text.indexOf(m); // e.g. play: declared after tracks:
        if (idx === -1) continue;
        cursor = idx + m.length;

        const tokens = elementsWithOffsets(m, idx);
        const noteTokens = tokens.filter((t) => !isMarkElement(t.text));
        if (noteTokens.length === 0) continue;
        const totalWeight = noteTokens.reduce((sum, t) => sum + tokenWeight(t.text), 0) || 1;
        const unit = measureBeats / totalWeight;
        let pos = 0;
        for (const tok of tokens) {
          if (isMarkElement(tok.text)) continue;
          const step = unit * tokenWeight(tok.text);
          if (!isRestElement(tok.text)) {
            const startBeat = mi * measureBeats + pos;
            spans.push({ from: tok.from, to: tok.to, startBeat, endBeat: startBeat + step, kind: 'beat' });
            emitGroupSpans(tok, startBeat, startBeat + step, spans);
          }
          pos += step;
        }
      }
    }

    if (node.tracks && typeof node.tracks === 'object') {
      for (const child of Object.values(node.tracks)) walk(child, measure);
    }
  };

  walk(doc, doc.measure);
  return spans;
}
