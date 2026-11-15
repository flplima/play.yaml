import type { MidiState } from './useMidi';
import { sendTestNote, type MidiRoute, type RouteMap } from './routes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** A distinct instrument from the current score, with the channel it declares. */
export interface SampleEntry {
  name: string;
  defaultChannel: number;
}

interface Props {
  samples: SampleEntry[];
  midi: MidiState;
  routes: RouteMap;
  onRouteChange: (sample: string, route: MidiRoute | undefined) => void;
  /** When the output selector is on Built-in, routing is parked. */
  disabled: boolean;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

/** The "Built-in synth" option needs a non-empty value: Radix reserves ''. */
const BUILTIN = '__builtin__';

export default function RoutingPanel({ samples, midi, routes, onRouteChange, disabled }: Props) {
  const outputById = new Map(midi.outputs.map((o) => [o.id, o]));
  const status = !midi.supported
    ? 'WebMIDI is not supported in this browser.'
    : midi.error ?? (midi.outputs.length === 0 ? 'No MIDI devices detected.' : null);

  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">MIDI routing</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Send each instrument to a MIDI in. Unrouted ones play on the built-in orchestra.
        </p>
        {status && !disabled && <p className="mt-2 text-xs text-warning">{status}</p>}
        {disabled && (
          <p className="mt-2 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-xs text-primary">
            Output is set to Built-in — everything plays on the bundled sampler
            &amp; synth. Switch the toggle above to Web MIDI to use these routes.
          </p>
        )}
      </div>

      <div className={cn('border-b border-border px-4 py-3', disabled && 'pointer-events-none opacity-40')}>
        {samples.length === 0 ? (
          <p className="text-xs text-muted-foreground">No instruments in the current score.</p>
        ) : (
          <ul className="space-y-3">
            {samples.map(({ name, defaultChannel }) => {
              const route = routes[name];
              return (
                <li key={name}>
                  <div className="truncate text-sm font-medium" title={name}>
                    {name}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Select
                      value={route?.outputId ?? BUILTIN}
                      onValueChange={(value) => {
                        const channel = route?.channel ?? defaultChannel;
                        onRouteChange(name, value === BUILTIN ? undefined : { outputId: value, channel });
                      }}
                    >
                      <SelectTrigger
                        className="min-w-0 flex-1"
                        title="MIDI in to send this instrument to"
                        aria-label={`MIDI output for ${name}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={BUILTIN}>Built-in synth</SelectItem>
                        {midi.outputs.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name || o.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      disabled={!route}
                      value={String(route?.channel ?? defaultChannel)}
                      onValueChange={(value) => route && onRouteChange(name, { ...route, channel: Number(value) })}
                    >
                      <SelectTrigger className="max-w-[140px]" title="MIDI channel" aria-label={`MIDI channel for ${name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHANNELS.map((ch) => (
                          <SelectItem key={ch} value={String(ch)}>
                            ch {ch}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={!route || !outputById.has(route.outputId)}
                      onClick={() => {
                        const output = route && outputById.get(route.outputId);
                        if (output) sendTestNote(output, route.channel);
                      }}
                      title="Send a short test note"
                    >
                      Test
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
