import { useEffect, useState } from 'react';

export interface MidiState {
  supported: boolean;
  error: string | null;
  outputs: MIDIOutput[];
  inputs: MIDIInput[];
  /**
   * Whether the browser granted SysEx. Without it the instrument panel can
   * still send built-in CCs but not the custom messages a VST's host-only
   * options travel on, so the panel needs to be able to say which half works.
   */
  sysex: boolean;
}

/**
 * Request WebMIDI access and keep the device lists in sync with hot-plugs.
 *
 * SysEx is asked for because the instrument panel needs it: a plugin option
 * that exists only as a host parameter cannot be a control change, and the
 * message that carries it is a SysEx (see core/src/surface.ts). Browsers
 * prompt separately for SysEx and can refuse it, so this falls back to a
 * plain request rather than losing MIDI output altogether — a studio that can
 * play notes but not tweak a plugin is much better than one that can do
 * neither.
 */
export function useMidi(): MidiState {
  const supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MIDIOutput[]>([]);
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [sysex, setSysex] = useState(false);

  useEffect(() => {
    if (!supported) return;
    let access: MIDIAccess | null = null;
    let cancelled = false;

    const refresh = () => {
      if (!access || cancelled) return;
      setOutputs([...access.outputs.values()]);
      setInputs([...access.inputs.values()]);
    };

    const adopt = (a: MIDIAccess, withSysex: boolean) => {
      if (cancelled) return;
      access = a;
      setSysex(withSysex);
      a.onstatechange = refresh;
      refresh();
    };

    navigator
      .requestMIDIAccess({ sysex: true })
      .then((a) => adopt(a, true))
      .catch(() =>
        navigator
          .requestMIDIAccess({ sysex: false })
          .then((a) => adopt(a, false))
          .catch((err: Error) => {
            if (!cancelled) setError(err.message || 'MIDI access denied');
          }),
      );

    return () => {
      cancelled = true;
      if (access) access.onstatechange = null;
    };
  }, [supported]);

  return { supported, error, outputs, inputs, sysex };
}
