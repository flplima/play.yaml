'use strict';

/**
 * musicxml.ts: a notation Score (notation.ts) → MusicXML 4.0 `score-partwise`.
 *
 * Plain string building, no XML library, so core keeps zero dependencies and
 * the output is byte-for-byte deterministic: no dates, no random ids, and
 * elements in the order the MusicXML schema requires (which is stricter than
 * most readers, so a file that LilyPond accepts can still fail validation;
 * the order below follows the XSD, not a reader).
 *
 * Every voice of every measure fills the measure, so moving to the next
 * voice is always a `<backup>` of one whole measure.
 */

import {
  Clef, NotationKey, MeasureInfo, NotationEvent, NotationVoice, Part, PartMeasure, Score, TempoMark,
} from './notation';

/** Escape text for element content and attribute values alike. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Numbers as MusicXML writes them: no exponent, no trailing zeros. */
function num(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

class Writer {
  private lines: string[] = [];
  private depth = 0;

  open(tag: string, attrs = ''): void {
    this.lines.push(`${'  '.repeat(this.depth)}<${tag}${attrs}>`);
    this.depth++;
  }

  close(tag: string): void {
    this.depth--;
    this.lines.push(`${'  '.repeat(this.depth)}</${tag}>`);
  }

  leaf(tag: string, text?: string | number, attrs = ''): void {
    const pad = '  '.repeat(this.depth);
    if (text === undefined) this.lines.push(`${pad}<${tag}${attrs}/>`);
    else this.lines.push(`${pad}<${tag}${attrs}>${typeof text === 'number' ? num(text) : escapeXml(text)}</${tag}>`);
  }

  raw(line: string): void {
    this.lines.push(line);
  }

  toString(): string {
    return this.lines.join('\n') + '\n';
  }
}

/** Encode a Score as an uncompressed MusicXML 4.0 document. */
export function encodeMusicXml(score: Score): string {
  const w = new Writer();
  w.raw('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  w.raw('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  w.open('score-partwise', ' version="4.0"');

  if (score.title) {
    w.open('work');
    w.leaf('work-title', score.title);
    w.close('work');
  }
  w.open('identification');
  if (score.composer) w.leaf('creator', score.composer, ' type="composer"');
  w.open('encoding');
  w.leaf('software', 'play.yaml');
  w.close('encoding');
  w.close('identification');

  w.open('part-list');
  for (const part of score.parts) writeScorePart(w, part);
  w.close('part-list');

  score.parts.forEach((part, index) => {
    w.open('part', ` id="${escapeXml(part.id)}"`);
    part.measures.forEach((pm, mi) => {
      writeMeasure(w, score, part, pm, score.measures[mi], mi, index === 0);
    });
    w.close('part');
  });

  w.close('score-partwise');
  return w.toString();
}

function writeScorePart(w: Writer, part: Part): void {
  w.open('score-part', ` id="${escapeXml(part.id)}"`);
  w.leaf('part-name', part.name);
  if (part.percussion) {
    for (const ins of part.instruments) {
      w.open('score-instrument', ` id="${escapeXml(ins.id)}"`);
      w.leaf('instrument-name', ins.name);
      w.close('score-instrument');
    }
    for (const ins of part.instruments) {
      w.open('midi-instrument', ` id="${escapeXml(ins.id)}"`);
      w.leaf('midi-channel', part.channel);
      w.leaf('midi-unpitched', ins.key + 1); // MusicXML counts keys from 1
      w.close('midi-instrument');
    }
  } else {
    const id = `${part.id}-I1`;
    w.open('score-instrument', ` id="${escapeXml(id)}"`);
    w.leaf('instrument-name', part.name);
    w.close('score-instrument');
    w.open('midi-instrument', ` id="${escapeXml(id)}"`);
    w.leaf('midi-channel', part.channel);
    if (part.program !== undefined) w.leaf('midi-program', part.program + 1); // and programs from 1
    w.close('midi-instrument');
  }
  w.close('score-part');
}

function writeKey(w: Writer, key: NotationKey): void {
  w.open('key');
  w.leaf('fifths', key.fifths);
  w.leaf('mode', key.mode);
  w.close('key');
}

function writeClef(w: Writer, clef: Clef, number: number | undefined): void {
  w.open('clef', number === undefined ? '' : ` number="${number}"`);
  w.leaf('sign', clef.sign);
  w.leaf('line', clef.line);
  w.close('clef');
}

function writeMeasure(
  w: Writer,
  score: Score,
  part: Part,
  pm: PartMeasure,
  info: MeasureInfo,
  index: number,
  withTempo: boolean,
): void {
  w.open('measure', ` number="${info.number}"`);
  const first = index === 0;
  if (first || pm.key || info.timeChanged || pm.clefs) {
    w.open('attributes');
    if (first) w.leaf('divisions', score.divisions);
    if (pm.key) writeKey(w, pm.key);
    if (info.timeChanged) {
      w.open('time');
      w.leaf('beats', info.time.beats);
      w.leaf('beat-type', info.time.beatType);
      w.close('time');
    }
    if (first) {
      if (part.staves > 1) w.leaf('staves', part.staves);
      part.clefs.forEach((clef, i) => writeClef(w, clef, part.staves > 1 ? i + 1 : undefined));
    } else {
      pm.clefs?.forEach((clef, i) => clef && writeClef(w, clef, part.staves > 1 ? i + 1 : undefined));
    }
    w.close('attributes');
  }

  // Tempo belongs to the whole score; it is written once, over the top part.
  if (withTempo) for (const mark of info.tempos) writeTempo(w, mark);

  pm.voices.forEach((voice, i) => {
    if (i > 0) {
      w.open('backup');
      w.leaf('duration', info.length);
      w.close('backup');
    }
    for (const event of voice.events) {
      if (event.kind === 'rest' && event.hidden) writeForward(w, part, voice, event.duration);
      else writeEvent(w, part, voice, event);
    }
  });
  w.close('measure');
}

/**
 * An unprinted rest is a `<forward>`: time that passes in the voice with
 * nothing drawn. Readers turn it into a spacer, where a rest marked
 * `print-object="no"` would still be laid out and collide.
 */
function writeForward(w: Writer, part: Part, voice: NotationVoice, duration: number): void {
  w.open('forward');
  w.leaf('duration', duration);
  w.leaf('voice', voice.voice);
  if (part.staves > 1) w.leaf('staff', voice.staff);
  w.close('forward');
}

function writeTempo(w: Writer, mark: TempoMark): void {
  w.open('direction', ' placement="above"');
  if (mark.words) {
    w.open('direction-type');
    w.leaf('words', mark.words);
    w.close('direction-type');
  } else {
    // Tempo words read before the number, in bold as editions set them.
    if (mark.text) {
      w.open('direction-type');
      w.leaf('words', mark.text, ' font-weight="bold"');
      w.close('direction-type');
    }
    if (!mark.hideMetronome) {
      w.open('direction-type');
      w.open('metronome');
      w.leaf('beat-unit', mark.beatUnit);
      if (mark.dotted) w.leaf('beat-unit-dot');
      w.leaf('per-minute', mark.perMinute);
      w.close('metronome');
      w.close('direction-type');
    }
  }
  // The direction sits before the first voice, at the measure's start; the
  // offset moves it (and its playback tempo) to where it belongs.
  if (mark.offset > 0) w.leaf('offset', mark.offset, ' sound="yes"');
  w.leaf('staff', 1);
  if (!mark.words) w.leaf('sound', undefined, ` tempo="${num(mark.bpm)}"`);
  w.close('direction');
}

function writeEvent(w: Writer, part: Part, voice: NotationVoice, event: NotationEvent): void {
  const members = event.kind === 'rest' ? [undefined] : event.notes;
  members.forEach((note, i) => {
    w.open('note');
    if (i > 0) w.leaf('chord');
    if (!note) {
      w.leaf('rest', undefined, event.measureRest ? ' measure="yes"' : '');
    } else if (note.drum) {
      w.open('unpitched');
      w.leaf('display-step', note.drum.step);
      w.leaf('display-octave', note.drum.octave);
      w.close('unpitched');
    } else if (note.pitch) {
      w.open('pitch');
      w.leaf('step', note.pitch.step);
      if (note.pitch.alter) w.leaf('alter', note.pitch.alter);
      w.leaf('octave', note.pitch.octave);
      w.close('pitch');
    }
    w.leaf('duration', event.duration);
    if (note && event.tieStop) w.leaf('tie', undefined, ' type="stop"');
    if (note && event.tieStart) w.leaf('tie', undefined, ' type="start"');
    if (note?.drum) w.leaf('instrument', undefined, ` id="${escapeXml(note.drum.instrument)}"`);
    w.leaf('voice', voice.voice);
    if (event.type) w.leaf('type', event.type);
    for (let d = 0; d < event.dots; d++) w.leaf('dot');
    if (note?.pitch?.accidental) w.leaf('accidental', note.pitch.accidental);
    if (event.tuplet) {
      w.open('time-modification');
      w.leaf('actual-notes', event.tuplet.actual);
      w.leaf('normal-notes', event.tuplet.normal);
      w.leaf('normal-type', event.tuplet.normalType);
      w.close('time-modification');
    }
    if (note && event.stem) w.leaf('stem', event.stem);
    if (note?.drum && note.drum.notehead !== 'normal') w.leaf('notehead', note.drum.notehead);
    if (part.staves > 1) w.leaf('staff', voice.staff);
    // Beams ride on the chord's first note, like its tuplet bracket.
    if (i === 0) event.beams?.forEach((value, level) => w.leaf('beam', value, ` number="${level + 1}"`));

    // Notations: ties, the tuplet bracket (on the chord's first note only)
    // and a roll's tremolo strokes.
    const tied = note && (event.tieStop || event.tieStart);
    const bracket = i === 0 && event.tuplet && (event.tuplet.start || event.tuplet.stop);
    const tremolo = note && event.tremolo;
    if (tied || bracket || tremolo) {
      w.open('notations');
      if (note && event.tieStop) w.leaf('tied', undefined, ' type="stop"');
      if (note && event.tieStart) w.leaf('tied', undefined, ' type="start"');
      if (bracket && event.tuplet!.start) w.leaf('tuplet', undefined, ' type="start" bracket="yes"');
      if (bracket && event.tuplet!.stop) w.leaf('tuplet', undefined, ' type="stop"');
      if (tremolo) {
        w.open('ornaments');
        w.leaf('tremolo', event.tremolo, ' type="single"');
        w.close('ornaments');
      }
      w.close('notations');
    }
    w.close('note');
  });
}
