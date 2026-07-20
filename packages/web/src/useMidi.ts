import { useEffect, useState } from 'react';

export interface MidiState {
  supported: boolean;
  error: string | null;
  outputs: MIDIOutput[];
}

/** Request WebMIDI access and keep the output list in sync with hot-plugs. */
export function useMidi(): MidiState {
  const supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MIDIOutput[]>([]);

  useEffect(() => {
    if (!supported) return;
    let access: MIDIAccess | null = null;
    let cancelled = false;

    const refresh = () => {
      if (access && !cancelled) setOutputs([...access.outputs.values()]);
    };

    navigator
      .requestMIDIAccess({ sysex: false })
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
  }, [supported]);

  return { supported, error, outputs };
}
