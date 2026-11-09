import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

export interface PlayingRange {
  from: number;
  to: number;
  kind: 'beat' | 'note';
}

export const setPlayingNotes = StateEffect.define<PlayingRange[]>();

const beatMark = Decoration.mark({ class: 'cm-playing-note' });
const subNoteMark = Decoration.mark({ class: 'cm-playing-subnote' });

const playingNoteField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setPlayingNotes)) {
        const max = tr.newDoc.length;
        value = Decoration.set(
          effect.value
            .filter((r) => r.from < r.to && r.to <= max)
            .sort((a, b) => a.from - b.from || a.to - b.to)
            .map((r) => (r.kind === 'note' ? subNoteMark : beatMark).range(r.from, r.to)),
          true,
        );
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// The studio's accent, from index.css, so a theme change reaches the editor too.
const playingNoteTheme = EditorView.baseTheme({
  '.cm-playing-note': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
    outline: '1px solid color-mix(in oklch, var(--primary) 50%, transparent)',
    borderRadius: '3px',
  },
  '.cm-playing-subnote': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 60%, transparent)',
    outline: '1px solid color-mix(in oklch, var(--primary) 90%, transparent)',
    borderRadius: '3px',
  },
});

export const playingNoteExtension = [playingNoteField, playingNoteTheme];
