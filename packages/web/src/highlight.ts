import { StateEffect, StateField, EditorSelection } from '@codemirror/state';
import { Decoration, EditorView, RectangleMarker, ViewPlugin, layer } from '@codemirror/view';
import type { DecorationSet, LayerMarker } from '@codemirror/view';

/**
 * What is sounding, as document ranges. A 'note' is a note with its holds
 * (`g _ _` in `g _ _ e`), drawn as one bar that fills from left to right
 * while it rings. A 'beat' is a {} group, outlined while it plays.
 */
export interface PlayingRange {
  from: number;
  to: number;
  kind: 'beat' | 'note';
  /** When a 'note' starts and ends, for its fill. */
  startBeat?: number;
  endBeat?: number;
}

export const setPlayingNotes = StateEffect.define<PlayingRange[]>();
const dropLeaving = StateEffect.define<null>();

/** How long a note that just ended keeps its mark, to fade out (ms). Matches note-out in index.css. */
const LEAVE_MS = 140;

const marks = {
  beat: Decoration.mark({ class: 'cm-playing-note' }),
  beatLeaving: Decoration.mark({ class: 'cm-playing-note cm-note-leaving' }),
};

interface Leaving extends PlayingRange {
  since: number;
}

interface PlayState {
  active: PlayingRange[];
  leaving: Leaving[];
  decorations: DecorationSet;
}

const same = (a: PlayingRange, b: PlayingRange) => a.from === b.from && a.to === b.to && a.kind === b.kind;

/** The groups are marks; the notes are drawn by `holdLayer`. */
function build(active: PlayingRange[], leaving: Leaving[]): PlayState {
  const ranges = [
    ...active.filter((r) => r.kind === 'beat').map((r) => ({ r, mark: marks.beat })),
    ...leaving.filter((r) => r.kind === 'beat').map((r) => ({ r, mark: marks.beatLeaving })),
  ];
  ranges.sort((a, b) => a.r.from - b.r.from || a.r.to - b.r.to);
  return {
    active,
    leaving,
    decorations: Decoration.set(
      ranges.map(({ r, mark }) => mark.range(r.from, r.to)),
      true,
    ),
  };
}

const playingNoteField = StateField.define<PlayState>({
  create: () => build([], []),
  update(value, tr) {
    let { active, leaving } = value;
    let changed = false;
    if (tr.docChanged) {
      const remap = <T extends PlayingRange>(r: T): T => ({
        ...r,
        from: tr.changes.mapPos(r.from, 1),
        to: tr.changes.mapPos(r.to, -1),
      });
      active = active.map(remap).filter((r) => r.from < r.to);
      leaving = leaving.map(remap).filter((r) => r.from < r.to);
      changed = true;
    }
    for (const effect of tr.effects) {
      if (effect.is(setPlayingNotes)) {
        const max = tr.newDoc.length;
        const next = effect.value.filter((r) => r.from < r.to && r.to <= max);
        const now = performance.now();
        // What was sounding and no longer is lingers briefly, fading out.
        const ended = active.filter((r) => !next.some((n) => same(n, r)));
        leaving = [
          ...leaving.filter((l) => !next.some((n) => same(n, l)) && !ended.some((e) => same(e, l))),
          ...ended.map((r) => ({ ...r, since: now })),
        ];
        active = next;
        changed = true;
      } else if (effect.is(dropLeaving)) {
        const now = performance.now();
        leaving = leaving.filter((l) => now - l.since < LEAVE_MS);
        changed = true;
      }
    }
    return changed ? build(active, leaving) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

/** Removes the fading-out marks once their animation is over. */
const leavingSweeper = ViewPlugin.fromClass(
  class {
    timer = 0;
    constructor(readonly view: EditorView) {}
    update() {
      if (this.timer || !this.view.state.field(playingNoteField).leaving.length) return;
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.view.dispatch({ effects: dropLeaving.of(null) });
      }, LEAVE_MS);
    }
    destroy() {
      window.clearTimeout(this.timer);
    }
  },
);

// ── the notes: one bar per note and its holds, filling as it rings ──────────

/** The transport position, per editor, as of the last frame. */
const playheads = new WeakMap<EditorView, number>();

/** How far through its span a note is, 0 to 1. */
function progress(startBeat: number, endBeat: number, beat: number | undefined): number {
  if (beat === undefined || !(endBeat > startBeat)) return 0;
  return Math.min(1, Math.max(0, (beat - startBeat) / (endBeat - startBeat)));
}

/**
 * A note's bar on the layer under the text. The layer sits outside the
 * editable content, so its nodes can be restyled every frame without
 * CodeMirror reading that as an edit.
 */
class HoldMarker implements LayerMarker {
  constructor(
    readonly view: EditorView,
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
    readonly startBeat: number,
    readonly endBeat: number,
    readonly leaving: boolean,
  ) {}

  draw(): HTMLElement {
    const el = document.createElement('div');
    el.className = this.leaving ? 'cm-hold cm-hold-leaving' : 'cm-hold';
    this.adjust(el);
    return el;
  }

  update(el: HTMLElement, prev: LayerMarker): boolean {
    // A note that ends gets a fresh node, so its fade-out starts from the top.
    if (!(prev instanceof HoldMarker) || prev.leaving !== this.leaving) return false;
    this.adjust(el);
    return true;
  }

  adjust(el: HTMLElement) {
    // The line box is taller than the text; the inset keeps the bar on the glyphs.
    el.style.left = `${this.left}px`;
    el.style.top = `${this.top + 2}px`;
    el.style.width = `${this.width}px`;
    el.style.height = `${Math.max(0, this.height - 4)}px`;
    el.dataset.start = String(this.startBeat);
    el.dataset.end = String(this.endBeat);
    const p = this.leaving ? 1 : progress(this.startBeat, this.endBeat, playheads.get(this.view));
    el.style.setProperty('--p', String(p));
  }

  eq(other: LayerMarker): boolean {
    return (
      other instanceof HoldMarker &&
      other.left === this.left &&
      other.top === this.top &&
      other.width === this.width &&
      other.height === this.height &&
      other.startBeat === this.startBeat &&
      other.endBeat === this.endBeat &&
      other.leaving === this.leaving
    );
  }
}

const holdLayer = layer({
  above: false,
  class: 'cm-holdLayer',
  update: (update) =>
    update.docChanged ||
    update.viewportChanged ||
    update.geometryChanged ||
    update.startState.field(playingNoteField) !== update.state.field(playingNoteField),
  markers(view) {
    const { active, leaving } = view.state.field(playingNoteField);
    const out: HoldMarker[] = [];
    const add = (r: PlayingRange, isLeaving: boolean) => {
      if (r.kind !== 'note') return;
      for (const rect of RectangleMarker.forRange(view, '', EditorSelection.range(r.from, r.to))) {
        if (rect.width == null) continue;
        out.push(new HoldMarker(view, rect.left, rect.top, rect.width, rect.height, r.startBeat ?? 0, r.endBeat ?? 0, isLeaving));
      }
    };
    for (const r of active) add(r, false);
    for (const r of leaving) add(r, true);
    return out;
  },
});

/**
 * Moves every sounding note's fill to `beat`. Called once a frame by the
 * player loop; touches the layer's own nodes only, no transaction.
 */
export function setPlayhead(view: EditorView, beat: number): void {
  playheads.set(view, beat);
  for (const el of view.scrollDOM.querySelectorAll<HTMLElement>('.cm-holdLayer > .cm-hold:not(.cm-hold-leaving)')) {
    el.style.setProperty('--p', String(progress(Number(el.dataset.start), Number(el.dataset.end), beat)));
  }
}

// The colours of the sounding notes, gruvbox aqua: yellow is the UI accent, so
// the marks stay off it. A note's bar is a pale track with a stronger fill up
// to `--p`. The fade in and out is index.css (note-in, note-out, hold-in,
// hold-out), keyed on these classes.
const playingNoteTheme = EditorView.baseTheme({
  '.cm-playing-note': {
    '--mark': 'var(--gb-aqua)',
    backgroundColor: 'color-mix(in srgb, var(--gb-aqua) 22%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--gb-aqua) 45%, transparent)',
    borderRadius: '3px',
  },
  '.cm-holdLayer > .cm-hold': {
    '--mark': 'var(--gb-aqua)',
    background:
      'linear-gradient(to right, color-mix(in srgb, var(--gb-aqua) 55%, transparent) calc(var(--p, 0) * 100%), color-mix(in srgb, var(--gb-aqua) 16%, transparent) 0)',
    outline: '1px solid color-mix(in srgb, var(--gb-aqua) 75%, transparent)',
    borderRadius: '3px',
  },
});

export const playingNoteExtension = [playingNoteField, leavingSweeper, holdLayer, playingNoteTheme];
