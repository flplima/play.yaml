import type { MidiState } from './useMidi';
import type { MidiRoute, RouteMap } from './player';
import { sendTestNote } from './player';

/** A distinct `sample:` from the current score, with the channel it declares. */
export interface SampleEntry {
  name: string;
  defaultChannel: number;
}

interface MidiPanelProps {
  samples: SampleEntry[];
  midi: MidiState;
  routes: RouteMap;
  onRouteChange: (sample: string, route: MidiRoute | undefined) => void;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

export default function MidiPanel({ samples, midi, routes, onRouteChange }: MidiPanelProps) {
  const outputById = new Map(midi.outputs.map((o) => [o.id, o]));

  // WebMIDI names ports from the browser's side: what it calls an "output" is
  // the MIDI IN of the synth or DAW receiving the notes, which is how the
  // panel labels them.
  const status = !midi.supported
    ? 'WebMIDI is not supported in this browser.'
    : midi.error
      ? midi.error
      : midi.outputs.length === 0
        ? 'No MIDI ins detected.'
        : null;

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-900">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-200">MIDI routing</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Send each instrument to a MIDI in. Unrouted ones play on the built-in synth.
        </p>
        {status && <p className="mt-2 text-xs text-amber-400">{status}</p>}
      </div>

      <div className="flex-1 px-4 py-3">
        {samples.length === 0 ? (
          <p className="text-xs text-zinc-500">No instruments in the current score.</p>
        ) : (
          <ul className="space-y-3">
            {samples.map(({ name, defaultChannel }) => {
              const route = routes[name];
              return (
                <li key={name}>
                  <div className="truncate text-sm font-medium text-zinc-200" title={name}>
                    {name}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <select
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-200"
                      title="MIDI in to send this instrument to"
                      value={route?.outputId ?? ''}
                      onChange={(e) => {
                        const outputId = e.target.value;
                        onRouteChange(
                          name,
                          outputId
                            ? { outputId, channel: route?.channel ?? defaultChannel }
                            : undefined,
                        );
                      }}
                    >
                      <option value="">Built-in synth</option>
                      {midi.outputs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name || o.id}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-200 disabled:opacity-40"
                      disabled={!route}
                      value={route?.channel ?? defaultChannel}
                      onChange={(e) =>
                        route && onRouteChange(name, { ...route, channel: Number(e.target.value) })
                      }
                      title="MIDI channel"
                    >
                      {CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>
                          ch {ch}
                        </option>
                      ))}
                    </select>
                    <button
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                      disabled={!route || !outputById.has(route.outputId)}
                      onClick={() => {
                        const output = route && outputById.get(route.outputId);
                        if (output && route) sendTestNote(output, route.channel);
                      }}
                      title="Send a short test note"
                    >
                      Test
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
