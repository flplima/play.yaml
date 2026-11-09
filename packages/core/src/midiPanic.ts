'use strict';

/**
 * midiPanic.ts — the controller resets a "stop" has to send, and their order.
 *
 * Every backend that streams MIDI (the browser's WebMIDI transport, the CLI)
 * needs the identical sequence, and each of them previously sent only All
 * Notes Off + All Sound Off. That is not enough: the
 * MIDI spec has All Notes Off leave damper-pedalled notes sounding, so a score
 * holding the sustain pedal — BWV 846 sets it to 110 — kept ringing after Stop
 * on any instrument that models a pedal properly.
 *
 * Hence the order below: lift the pedals first so the notes are free to stop,
 * then reset the rest, then the two blanket kills. Reset All Controllers (121)
 * deliberately does not touch CC7 volume or CC10 pan, per the spec, so a stop
 * does not silently re-level the instruments.
 */

import { CC } from './vocabulary';

/** `[controller, value]` pairs to send on every channel, in this order. */
const PANIC_CONTROLS: readonly (readonly [number, number])[] = [
  [CC.sustain, 0], // damper — must come before All Notes Off
  [CC.sostenuto, 0], // holds notes the same way
  [CC.soft, 0],
  [121, 0], // reset all controllers (expression, modulation, bend, aftertouch)
  [123, 0], // all notes off
  [120, 0], // all sound off
];

/** MIDI channels, 0-based, for a full panic sweep. */
const ALL_CHANNELS: readonly number[] = Array.from({ length: 16 }, (_, i) => i);

/**
 * Every `(channel, controller, value)` a stop should send. Backends differ in
 * how they put bytes on the wire, so this yields the data and lets each send
 * it its own way.
 */
export function panicMessages(
  channels: readonly number[] = ALL_CHANNELS,
): { channel: number; controller: number; value: number }[] {
  const out: { channel: number; controller: number; value: number }[] = [];
  for (const channel of channels) {
    for (const [controller, value] of PANIC_CONTROLS) out.push({ channel, controller, value });
  }
  return out;
}
