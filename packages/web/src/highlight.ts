import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

export interface PlayingRange {
  from: number;
  to: number;
  kind: 'beat' | 'note';
}

export const setPlayingNotes = StateEffect.define<PlayingRange[]>();
const dropLeaving = StateEffect.define<null>();

/** How long a note that just ended keeps its mark, to fade out (ms). Matches note-out in index.css. */
const LEAVE_MS = 140;

const marks = {
  beat: Decoration.mark({ class: 'cm-playing-note' }),
  note: Decoration.mark({ class: 'cm-playing-subnote' }),
  beatLeaving: Decoration.mark({ class: 'cm-playing-note cm-note-leaving' }),
  noteLeaving: Decoration.mark({ class: 'cm-playing-subnote cm-note-leaving' }),
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

function build(active: PlayingRange[], leaving: Leaving[]): PlayState {
  const ranges = [
    ...active.map((r) => ({ r, mark: r.kind === 'note' ? marks.note : marks.beat })),
    ...leaving.map((r) => ({ r, mark: r.kind === 'note' ? marks.noteLeaving : marks.beatLeaving })),
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

// The colours of the sounding notes. Both are gruvbox aqua, the exact sub-note
// stronger; yellow is the UI accent, so the marks stay off it. The fade in and
// out is index.css (note-in, note-out), keyed on these classes.
const playingNoteTheme = EditorView.baseTheme({
  '.cm-playing-note': {
    '--mark': 'var(--gb-aqua)',
    backgroundColor: 'color-mix(in srgb, var(--gb-aqua) 22%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--gb-aqua) 45%, transparent)',
    borderRadius: '3px',
  },
  '.cm-playing-subnote': {
    '--mark': 'var(--gb-aqua)',
    backgroundColor: 'color-mix(in srgb, var(--gb-aqua) 50%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--gb-aqua) 90%, transparent)',
    borderRadius: '3px',
  },
});

export const playingNoteExtension = [playingNoteField, leavingSweeper, playingNoteTheme];
