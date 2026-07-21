'use strict';

/**
 * tokens.ts — splitting measure strings into tokens and classifying them:
 * is this a note, a rest, a hold, an inline directive, or a bare expression
 * mark that takes no time at all?
 */

import { noteToMidi } from './theory';
import { parseSet } from './set';

/** The token that prolongs the previous note rather than striking a new one. */
export const HOLD = '_';

/** Is this token an inline `||…||` set directive? */
export function isSetToken(token: string): boolean {
  return token.startsWith('||');
}

/** Is this token an inline `==…==` scale or chord change? */
export function isScaleToken(token: string): boolean {
  return token.startsWith('==');
}

/** "||g lyd, oct up||" → "g lyd, oct up"; "==Dm7==" → "Dm7". */
export function setTokenBody(token: string): string {
  const closer = isScaleToken(token) ? '==' : '||';
  return token.slice(2, token.endsWith(closer) ? -2 : undefined).trim();
}

/**
 * Split on whitespace at bracket depth 0 ("{c [d e]} f" → ["{c [d e]}", "f"]).
 * A `||…||` set directive is one token regardless of the spaces inside it.
 */
export function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // `||…||` and `==…==` are single tokens however many spaces they contain.
    const fence = depth === 0 && ((ch === '|' && text[i + 1] === '|') || (ch === '=' && text[i + 1] === '='))
      ? ch + ch
      : null;
    if (fence) {
      flush();
      const close = text.indexOf(fence, i + 2);
      const end = close === -1 ? text.length : close + 2;
      out.push(text.slice(i, end));
      i = end - 1;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch)) flush();
    else current += ch;
  }
  flush();
  return out;
}

/** Could this token appear in a measure — a note, degree, rest, hold or group? */
export function isMeasureToken(token: string): boolean {
  // Suffix marks (accents, strums) don't change what a token is — but a bare
  // `~` is the rest, not a suffix.
  const suffix = /([<>~]+)$/.exec(token);
  if (suffix && suffix[1].length < token.length) token = token.slice(0, -suffix[1].length);
  if (token === '~' || token === HOLD) return true;
  if (token[0] === '{' || token[0] === '[') return true;
  if (isSetToken(token) || isScaleToken(token)) return true;
  if (/^_+\S/.test(token)) return true; // _1, __d3
  if (/^-?\d+(#|b)?[+^-]*$/.test(token)) return true; // scale degree
  return noteToMidi(token) !== null;
}

/**
 * Is this play-list string an expression mark rather than a measure?
 *
 * Measures win any tie: a string whose tokens all read as notes is always a
 * measure, so `"f"` stays the note F rather than becoming forte (write
 * `"forte"`, or `set: f`, when you mean the dynamic).
 */
export function isDirectiveString(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const tokens = splitTopLevel(trimmed);
  if (tokens.length > 0 && tokens.every(isMeasureToken)) return false;
  try {
    // Classification only — a technique word is a directive even when the
    // track hasn't mapped its control yet (compilation stays strict).
    parseSet(trimmed, {}, { ignoreMissingControls: true });
    return true;
  } catch {
    return false; // neither — leave it to the measure parser to complain
  }
}
