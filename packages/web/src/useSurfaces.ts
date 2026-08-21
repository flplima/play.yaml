/**
 * The bridge between the studio and whatever VST rack is running here.
 *
 * Two halves. `useSurfaceCatalogue` asks the dev server what the rack says it
 * is hosting — a rack publishes that to a cache file precisely because a MIDI
 * cable cannot be asked. `useControlPort` finds that rack's control port among
 * the browser's MIDI devices, sends messages to it, and listens for the
 * acknowledgements that come back.
 *
 * The acknowledgements are the reason this is a hook and not three lines
 * inline. Sending MIDI is fire-and-forget by nature: a slider that does
 * nothing looks exactly like a slider whose message went nowhere. The control
 * protocol answers every message, so the panel can distinguish "applied,
 * Pipe Length = 0.82" from "no control called pipe-length" from silence — and
 * silence, specifically, means the cable is wrong rather than the name.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTROL_STATUS_TEXT,
  ControlOp,
  decodeControlMessage,
  pingMessage,
  type ControlWire,
  type SurfaceCatalogue,
} from '@play.yaml/core';
import type { MidiState } from './useMidi';

export type CatalogueState = {
  loading: boolean;
  /** Null until a rack has published one. */
  catalogue: SurfaceCatalogue | null;
  error: string;
  reload: () => void;
};

export function useSurfaceCatalogue(): CatalogueState {
  const [loading, setLoading] = useState(true);
  const [catalogue, setCatalogue] = useState<SurfaceCatalogue | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/server-surfaces')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setCatalogue(body.catalogue ?? null);
        setError(body.available ? '' : String(body.error ?? ''));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { loading, catalogue, error, reload };
}

/** What the rack said about the last thing we sent. */
export type Acknowledgement = {
  ok: boolean;
  text: string;
  at: number;
};

export type ControlPortState = {
  /** The rack's control port, if this browser can see it. */
  output: MIDIOutput | null;
  /** Its reply side, if the browser also exposes that. */
  input: MIDIInput | null;
  /** Send one or more messages. Returns false if there is nowhere to send. */
  send: (wires: ControlWire[]) => boolean;
  ping: () => void;
  last: Acknowledgement | null;
  /** True once a reply of any kind has arrived — proof the loop is closed. */
  answering: boolean;
};

/**
 * A MIDI port name is decorated differently by every backend — ALSA turns
 * "jukebox-control" into "RtMidi Input Client:jukebox-control 128:0" — so
 * matching is by substring in both directions rather than by equality.
 */
function findPort<T extends MIDIPort>(ports: T[], wanted: string): T | null {
  if (!wanted) return null;
  const needle = wanted.toLowerCase();
  return (
    ports.find((p) => (p.name ?? '').toLowerCase().includes(needle)) ??
    ports.find((p) => needle.includes((p.name ?? '').toLowerCase()) && (p.name ?? '').length > 3) ??
    null
  );
}

export function useControlPort(
  midi: MidiState,
  catalogue: SurfaceCatalogue | null,
): ControlPortState {
  const wanted = catalogue?.controlPort ?? '';
  const [last, setLast] = useState<Acknowledgement | null>(null);
  const [answering, setAnswering] = useState(false);
  const timer = useRef<number | null>(null);

  const output = useMemo(() => findPort(midi.outputs, wanted), [midi.outputs, wanted]);
  const input = useMemo(() => findPort(midi.inputs, wanted), [midi.inputs, wanted]);

  useEffect(() => {
    if (!input) return;
    const onMessage = (event: MIDIMessageEvent) => {
      let message;
      try {
        message = decodeControlMessage([...(event.data ?? [])]);
      } catch (err) {
        setLast({ ok: false, text: (err as Error).message, at: Date.now() });
        return;
      }
      if (!message) return; // someone else's SysEx
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      setAnswering(true);
      if (message.op === ControlOp.Pong) {
        setLast({
          ok: true,
          text: `rack "${message.rack}" · protocol v${message.version} · ${message.ports} port(s)`,
          at: Date.now(),
        });
      } else if (message.op === ControlOp.Ack) {
        setLast({
          ok: message.status === 0,
          text: message.detail || CONTROL_STATUS_TEXT[message.status] || `status ${message.status}`,
          at: Date.now(),
        });
      }
    };
    input.addEventListener('midimessage', onMessage as EventListener);
    // Some backends only start delivering once the port is explicitly opened.
    void input.open?.();
    return () => input.removeEventListener('midimessage', onMessage as EventListener);
  }, [input]);

  const send = useCallback(
    (wires: ControlWire[]) => {
      if (!output || !wires.length) return false;
      const needsSysex = wires.some((w) => w.kind === 'sysex');
      if (needsSysex && !midi.sysex) {
        setLast({
          ok: false,
          text: 'this browser withheld SysEx permission, so host-only options cannot be sent',
          at: Date.now(),
        });
        return false;
      }
      for (const wire of wires) output.send(wire.bytes);

      // Only the dialect gets answered; a relayed control change is just MIDI
      // passing through and will never reply. Saying that beats a spinner that
      // never resolves.
      if (!needsSysex) {
        setLast({ ok: true, text: `${wires[0].description} — sent (relayed, not acknowledged)`, at: Date.now() });
        return true;
      }
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setLast({ ok: false, text: 'no reply from the rack', at: Date.now() });
      }, 3000);
      return true;
    },
    [output, midi.sysex],
  );

  const ping = useCallback(() => {
    send([pingMessage()]);
  }, [send]);

  return { output, input, send, ping, last, answering };
}
