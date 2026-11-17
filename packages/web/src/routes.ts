/**
 * routes.ts — sending a score's instruments to MIDI devices: the routing
 * table, how it is kept between visits, and the WebMIDI wire format.
 */
import { CC, panicMessages } from '@play.yaml/core';
import { storageKey } from './storage';

/** Where a sample (the DSL's instrument name) should be routed. */
export interface MidiRoute {
  outputId: string;
  channel: number; // 1-16
}

/** Keyed by sample name — "cello", "piano", … */
export type RouteMap = Record<string, MidiRoute | undefined>;

/**
 * The routing key for a compiled track: its kit, else its sample. Routing is
 * per instrument, not per track — several tracks can share one instrument,
 * and that is what a MIDI device stands in for.
 */
export function routeKey(track: { preset: string; kit?: string }): string {
  return track.kit ?? track.preset;
}

const STORAGE_KEY = storageKey('midi-routes');

export function loadRoutes(): RouteMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveRoutes(routes: RouteMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
}

// ── the wire ──

export const NOTE_ON = 0x90;
export const NOTE_OFF = 0x80;
export const CONTROL_CHANGE = 0xb0;

/** A route's channel as the status byte wants it (0-based). */
export function wireChannel(channel: number): number {
  return (channel - 1) & 0x0f;
}

/**
 * Physical-modelling instruments take their loudness from the expression
 * controller rather than from note velocity: a bowed or blown voice with
 * expression at zero has zero bow speed / breath pressure, so it stays silent
 * however many notes arrive. Expression is CC11 in keyboard mode and CC2 in
 * wind-controller mode, so both go out; instruments that use neither ignore
 * them.
 */
export function sendExpression(output: MIDIOutput, channel: number, value: number): void {
  const v = Math.max(0, Math.min(127, Math.round(value)));
  output.send([CONTROL_CHANGE | channel, CC.expression, v]);
  output.send([CONTROL_CHANGE | channel, CC.breath, v]);
}

/** Silence a device: queued messages, pedals, then the blanket kills. */
export function allNotesOff(output: MIDIOutput): void {
  try {
    // In the spec but missing from TS's lib.dom, and optional in some implementations.
    (output as MIDIOutput & { clear?: () => void }).clear?.();
  } catch {
    // Ignore.
  }
  for (const msg of panicMessages()) {
    try {
      output.send([CONTROL_CHANGE | msg.channel, msg.controller, msg.value]);
    } catch {
      // The device may have been unplugged mid-playback.
    }
  }
}

/** Send a short middle-C blip so the user can verify a device/channel mapping. */
export function sendTestNote(output: MIDIOutput, channel: number): void {
  const ch = wireChannel(channel);
  const note = 60;
  sendExpression(output, ch, 100); // else bowed/blown instruments test silently
  output.send([NOTE_ON | ch, note, 100]);
  // Held open by a timer rather than a send() timestamp — see player.ts.
  window.setTimeout(() => output.send([NOTE_OFF | ch, note, 0]), 400);
}
