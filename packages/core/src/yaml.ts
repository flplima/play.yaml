'use strict';

/**
 * yaml.ts — a tiny, zero-dependency YAML subset in TypeScript.
 */

interface Token {
  indent: number;
  text: string;
}

/**
 * Fold literal block scalars (`key: |`) into single-line JSON-quoted scalars
 * before tokenizing, so the line-oriented parser below never sees them.
 */
function foldBlockScalars(src: string): string {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = /^(\s*)([^:#'"]+):\s*\|[+-]?\s*$/.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const keyIndent = m[1].length;
    const block: string[] = [];
    let blockIndent = -1;
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (line.trim() === '') {
        block.push('');
        j++;
        continue;
      }
      const indent = line.length - line.replace(/^\s+/, '').length;
      if (indent <= keyIndent) break;
      if (blockIndent === -1) blockIndent = indent;
      block.push(line.slice(blockIndent));
      j++;
    }
    while (block.length && block[block.length - 1] === '') block.pop();
    out.push(`${m[1]}${m[2]}: ${JSON.stringify(block.join('\n'))}`);
    i = j;
  }
  return out.join('\n');
}

/** Split into significant lines: { indent, text } with comments/blank removed. */
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  for (const raw of src.split(/\r?\n/)) {
    let inS = false;
    let inD = false;
    let s = '';
    for (let k = 0; k < raw.length; k++) {
      const c = raw[k];
      if (inS) {
        s += c;
        if (c === "'") inS = false;
        continue;
      }
      if (inD) {
        s += c;
        if (c === '"' && raw[k - 1] !== '\\') inD = false;
        continue;
      }
      if (c === "'") {
        inS = true;
        s += c;
        continue;
      }
      if (c === '"') {
        inD = true;
        s += c;
        continue;
      }
      if (c === '#' && (k === 0 || /\s/.test(raw[k - 1]))) break; // comment
      s += c;
    }
    const trimmedRight = s.replace(/\s+$/, '');
    if (trimmedRight.trim() === '') continue;
    const indent = trimmedRight.length - trimmedRight.replace(/^\s+/, '').length;
    out.push({ indent, text: trimmedRight.slice(indent) });
  }
  return out;
}

function isSeqLine(text: string): boolean {
  return text[0] === '-' && (text.length === 1 || text[1] === ' ');
}

function isKeyLine(text: string): boolean {
  if (text[0] === '"' || text[0] === "'") return false;
  return /^[^:'"]+:(\s|$)/.test(text);
}

function splitKey(text: string): { key: string; rest: string } {
  const m = /^([^:]+):(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return { key: text.trim(), rest: '' };
  return { key: m[1].trim(), rest: m[2] != null ? m[2].trim() : '' };
}

/** Split "a: 1, b: 2" on commas that sit outside brackets/quotes. */
function splitFlow(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseScalar(s: string): any {
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s[0] === '"' && s[s.length - 1] === '"') return JSON.parse(s);
  if (s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  // Inline flow mapping — only when it actually holds "key: value" pairs, so
  // an unquoted measure like {1 2 3 4} stays the string it looks like.
  if (s[0] === '{' && s[s.length - 1] === '}') {
    const entries = splitFlow(s.slice(1, -1));
    if (entries.length && entries.every((e) => /^[^:]+:\s*\S/.test(e))) {
      const map: Record<string, any> = {};
      for (const entry of entries) {
        const idx = entry.indexOf(':');
        map[entry.slice(0, idx).trim().replace(/^["']|["']$/g, '')] =
          parseScalar(entry.slice(idx + 1).trim());
      }
      return map;
    }
  }
  if (s[0] === '[' && s[s.length - 1] === ']') {
    return splitFlow(s.slice(1, -1)).map(parseScalar);
  }
  return s;
}

export function parseYaml(src: string): any {
  const toks = tokenize(foldBlockScalars(src));
  let pos = 0;

  // `&name` anchors a value, `*name` repeats it — the YAML-native way to
  // write a musical repeat once and play it again.
  const anchors: Record<string, any> = {};

  function parseValue(text: string): any {
    const anchor = /^&([\w-]+)\s+([\s\S]+)$/.exec(text);
    if (anchor) {
      const value = parseScalar(anchor[2].trim());
      anchors[anchor[1]] = value;
      return value;
    }
    const alias = /^\*([\w-]+)$/.exec(text);
    if (alias) {
      if (!(alias[1] in anchors)) {
        throw new Error(`Unknown YAML alias "*${alias[1]}" — no &${alias[1]} anchor before it.`);
      }
      return anchors[alias[1]];
    }
    return parseScalar(text);
  }

  function parseNode(indent: number): any {
    const t = toks[pos];
    if (!t) return null;
    return isSeqLine(t.text) ? parseSeq(indent) : parseMap(indent);
  }

  function parseMap(indent: number): any {
    const map: Record<string, any> = {};
    while (pos < toks.length && toks[pos].indent === indent && !isSeqLine(toks[pos].text)) {
      const { key, rest } = splitKey(toks[pos].text);
      pos++;
      if (rest !== '') {
        map[key] = parseValue(rest);
      } else if (pos < toks.length && toks[pos].indent > indent) {
        map[key] = parseNode(toks[pos].indent);
      } else {
        map[key] = null;
      }
    }
    return map;
  }

  function parseSeq(indent: number): any[] {
    const arr: any[] = [];
    while (pos < toks.length && toks[pos].indent === indent && isSeqLine(toks[pos].text)) {
      const t = toks[pos];
      const after = t.text.slice(1).replace(/^\s*/, '');
      const contentIndent = indent + (t.text.length - after.length);
      if (after === '') {
        pos++;
        arr.push(pos < toks.length && toks[pos].indent > indent ? parseNode(toks[pos].indent) : null);
      } else if (isKeyLine(after)) {
        toks[pos] = { indent: contentIndent, text: after }; // re-anchor the dash line as a map key
        arr.push(parseMap(contentIndent));
      } else {
        arr.push(parseValue(after));
        pos++;
      }
    }
    return arr;
  }

  return parseNode(toks.length ? toks[0].indent : 0);
}
