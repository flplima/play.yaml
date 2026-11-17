'use strict';

/**
 * tokens.ts — splitting measure strings into tokens and classifying them:
 * is this a note, a rest, a hold, an inline directive? Every consumer of a
 * measure string — the compiler, the measure counter, the editor highlighter
 * — reads it through here, so the token grammar lives in one place.
 */

import { isDegreeToken, noteToMidi } from './theory';

/** The token that prolongs the previous note rather than striking a new one. */
export const HOLD = '_';
export const REST = '~';

/** Is this token an inline `||…||` set directive? */
export function isSetToken(token: string): boolean {
  return token.startsWith('||');
}

/** Is this token an inline `==…==` scale or chord change? */
export function isScaleToken(token: string): boolean {
  return token.startsWith('==');
}

/** A `||…||` or `==…==` token: changes state, takes no time. */
export function isMarkToken(token: string): boolean {
  return isSetToken(token) || isScaleToken(token);
}

/** "||g lyd, oct up||" → "g lyd, oct up"; "==Dm7==" → "Dm7". */
export function setTokenBody(token: string): string {
  const closer = isScaleToken(token) ? '==' : '||';
  return token.slice(2, token.endsWith(closer) ? -2 : undefined).trim();
}

/**
 * Where a `#` comment starts in a bar line, or -1. A comment is a `#` at the
 * start of the line or after a space, outside a `||…||` or `==…==` fence:
 * `e _ _ _   # A-` is the bar `e _ _ _`. A sharp is attached to its letter
 * or degree (`c#`, `4#`), so it never starts a comment.
 */
export function commentStart(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === '|' && text[i + 1] === '|') || (ch === '=' && text[i + 1] === '=')) {
      const close = text.indexOf(ch + ch, i + 2);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return i;
  }
  return -1;
}

/** A bar line without its `#` comment. */
export function stripComment(text: string): string {
  const at = commentStart(text);
  return at === -1 ? text : text.slice(0, at).trimEnd();
}

/** A token with its character range in the string it was split from. */
export interface TokenSpan {
  text: string;
  from: number;
  to: number;
}

/**
 * Split on whitespace at bracket depth 0 ("{c [d e]} f" → ["{c [d e]}", "f"]),
 * keeping each token's offsets. A `||…||` or `==…==` directive is one token
 * regardless of the spaces inside it.
 */
export function tokenSpans(text: string): TokenSpan[] {
  const out: TokenSpan[] = [];
  const comment = commentStart(text);
  if (comment !== -1) text = text.slice(0, comment);
  let depth = 0;
  let start = -1;
  const flush = (end: number) => {
    if (start !== -1 && end > start) out.push({ text: text.slice(start, end), from: start, to: end });
    start = -1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const fence =
      depth === 0 && ((ch === '|' && text[i + 1] === '|') || (ch === '=' && text[i + 1] === '='))
        ? ch + ch
        : null;
    if (fence) {
      flush(i);
      const close = text.indexOf(fence, i + 2);
      const end = close === -1 ? text.length : close + 2;
      out.push({ text: text.slice(i, end), from: i, to: end });
      i = end - 1;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) flush(i);
    else if (start === -1) start = i;
  }
  flush(text.length);
  return out;
}

/** The tokens of a measure string, without offsets. */
export function splitTopLevel(text: string): string[] {
  return tokenSpans(text).map((t) => t.text);
}

/**
 * Separate a token from its suffix marks: `>` accents, `<` softens, `~`
 * rolls, `.`/`:` weight the duration. `[c e g]~>` → core `[c e g]`, marks
 * `~>`. A bare `~` is the rest, not a suffix, so `~:` is a weighted rest.
 */
export function peelSuffix(token: string): { core: string; marks: string } {
  const weightedRest = /^~([<>:.]+)$/.exec(token);
  if (weightedRest) return { core: REST, marks: weightedRest[1] };
  const suffix = /([<>~:.]+)$/.exec(token);
  if (suffix && suffix[1].length < token.length) {
    return { core: token.slice(0, -suffix[1].length), marks: suffix[1] };
  }
  return { core: token, marks: '' };
}

/** A rest, weighted or not. */
export function isRestToken(token: string): boolean {
  return peelSuffix(token).core === REST;
}

/**
 * Duration weight of a measure token from its suffix: each `.` multiplies by
 * 1.5 (a dot), each `:` by 2, stackable (`c4:.` = 3, `c4::` = 4). Tokens in
 * a measure (or group) share the available time proportionally to their
 * weights — `"c4: d4 c4"` in 4/4 is a half note and two quarters.
 */
export function tokenWeight(token: string): number {
  let weight = 1;
  for (const ch of peelSuffix(token).marks) {
    if (ch === ':') weight *= 2;
    else if (ch === '.') weight *= 1.5;
  }
  return weight;
}

/** One token's slot inside the span it shares with its neighbours. */
export interface Slot {
  offset: number;
  span: number;
}

/** Share `span` among the tokens in proportion to their duration weights. */
export function divideByWeight(tokens: string[], span: number): Slot[] {
  const weights = tokens.map(tokenWeight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let offset = 0;
  return weights.map((w) => {
    const slot = { offset, span: (span * w) / total };
    offset += slot.span;
    return slot;
  });
}

/** Could this token appear in a measure — a note, degree, rest, hold or group? */
export function isMeasureToken(token: string): boolean {
  const { core } = peelSuffix(token);
  if (core === REST || core === HOLD) return true;
  if (core[0] === '{' || core[0] === '[') return true;
  if (isMarkToken(core)) return true;
  if (/^_+\S/.test(core)) return true; // _1, __d3
  return isDegreeToken(core) || noteToMidi(core) !== null;
}
