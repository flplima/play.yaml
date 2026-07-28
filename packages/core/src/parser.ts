'use strict';

/**
 * parser.ts — the play.yaml DSL → timeline compiler, in five layers:
 *
 *   theory.ts      pitch, scale and meter math (noteToMidi, parseScale, …)
 *   vocabulary.ts  the musical words: dynamics, articulations, tempo marks,
 *                  playing techniques, named controls
 *   set.ts         the `set` shorthand — "g lydian, octave up" → prop patch
 *   tokens.ts      measure-string tokenizing and token classification
 *   generate.ts    deterministic generators (spread/arp/walk) and the seeded
 *                  hash behind chance/humanize
 *   song.ts        the compiler: measures → timelines, documents → songs
 *
 * This module re-exports all of them, so `import … from './parser'` (or from
 * the package root) always works regardless of where a symbol lives.
 *
 * The DSL itself: a document IS a track. Any track may declare child tracks,
 * which inherit every property from their parent (except `play`) and may
 * override any of them:
 *
 *   tempo: 80
 *   measure: 4/4
 *   sample: piano
 *   play: "c d e d"          # the root itself plays
 *   tracks:
 *     bassline:
 *       sample: bass         # overrides `sample`, inherits everything else
 *       play:
 *         - "c c ~ ~ c c ~ ~"
 *
 * Each string in a `play` array (or line in a multiline string) is one
 * measure. The measure's duration is divided EQUALLY among its
 * whitespace-separated tokens: 4 tokens in 4/4 are quarter notes, 8 tokens
 * are eighth notes. Tokens recurse:
 *   ~          rest
 *   _          hold — prolongs the previous note through this slot (a tie),
 *              at any depth and across barlines
 *   c  eb3     note — letter, optional #/b, optional octave (default 4)
 *   1  8  4#   scale degree in the track's `scale` (default "c major"):
 *              1 = root at the track's `octave`, 8 = root an octave up,
 *              trailing #/b raises/lowers a semitone
 *   5^ 5+ 5-   octave modifiers, repeatable: ^ or + shifts a note up an
 *              octave, - shifts it down (5^^ = the fifth two octaves up).
 *              They follow any accidental: 4#^
 *   [c e g]    chord — simultaneous, each element spans the whole slot
 *   {c {d e}}  group — the slot is divided equally among elements, recursively
 */

export * from './theory';
export * from './vocabulary';
export * from './set';
export * from './tokens';
export * from './generate';
export * from './song';
