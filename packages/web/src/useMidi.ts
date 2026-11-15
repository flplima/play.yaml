import { useEffect, useState } from 'react';

export interface MidiState {
  supported: boolean;
  error: string | null;
  outputs: MIDIOutput[];
}

/**
 * Request WebMIDI access and keep the device lists in sync with hot-plugs.
 *
 * The browser asks the user for permission the moment access is requested, so
 * it is only requested once `enabled` is true: a visitor who just presses
 * Play on the built-in sounds never sees the prompt.
 */
export function useMidi(enabled: boolean): MidiState {
  const supported = 'requestMIDIAccess' in navigator;
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MIDIOutput[]>([]);

  useEffect(() => {
    if (!supported || !enabled) return;
    let access: MIDIAccess | null = null;
    let cancelled = false;

    const refresh = () => {
      if (!access || cancelled) return;
      setOutputs([...access.outputs.values()]);
    };

    navigator
      .requestMIDIAccess()
      .then((a) => {
        if (cancelled) return;
        access = a;
        a.onstatechange = refresh;
        refresh();
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'MIDI access denied');
      });

    return () => {
      cancelled = true;
      if (access) access.onstatechange = null;
    };
  }, [supported, enabled]);

  return { supported, error, outputs };
}
