import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { GRUVBOX as g } from './palette';

/**
 * Gruvbox dark for the editor. The chrome (background, gutters, cursor,
 * selection) is an EditorView theme; the colours of the YAML tokens are a
 * HighlightStyle. The playing-note marks live in highlight.ts.
 */
const chrome = EditorView.theme(
  {
    '&': { color: g.fg, backgroundColor: g.bg0 },
    '.cm-content': { caretColor: g.fg },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: g.fg },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: g.bg3 },
    '.cm-activeLine': { backgroundColor: g.bg0S },
    '.cm-gutters': { backgroundColor: g.bg0, color: g.bg4, border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: g.bg0S, color: g.fg3 },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px' },
    '.cm-foldPlaceholder': { backgroundColor: g.bg1, color: g.fg4, border: 'none' },
    '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: g.bg2, outline: 'none' },
    '.cm-searchMatch': { backgroundColor: g.bg2, outline: `1px solid ${g.yellow}` },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: g.bg3 },
    '.cm-tooltip': { backgroundColor: g.bg1, color: g.fg, border: `1px solid ${g.bg2}` },
    '.cm-panels': { backgroundColor: g.bg1, color: g.fg },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: g.blue },
  { tag: [t.string, t.special(t.string)], color: g.green },
  { tag: [t.number, t.integer, t.float], color: g.purple },
  { tag: [t.bool, t.null, t.atom, t.literal], color: g.purple },
  { tag: [t.lineComment, t.blockComment, t.comment], color: g.gray, fontStyle: 'italic' },
  { tag: [t.separator, t.punctuation, t.squareBracket, t.brace, t.bracket], color: g.fg4 },
  { tag: [t.meta, t.processingInstruction], color: g.aqua },
  { tag: [t.labelName, t.typeName, t.tagName], color: g.yellow },
  { tag: [t.keyword, t.operator], color: g.red },
  { tag: t.invalid, color: g.red },
]);

export const gruvboxEditorTheme = [chrome, syntaxHighlighting(highlight)];
