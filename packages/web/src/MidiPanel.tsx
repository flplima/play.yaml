import { useMemo } from 'react';
import { Music2, Volume2, Zap } from 'lucide-react';
import type { CompiledSong } from '@play.yaml/core';
import type { MidiState } from './useMidi';
import type { MidiRoute, RouteMap } from './player';
import { sendTestNote } from './player';
import { calculateRealTempo, getLiveTrackStates } from './trackMonitor';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NO_RACK, type RackSnapshot } from './useRack';

/** A distinct `sample:` from the current score, with the channel it declares. */
export interface SampleEntry {
  name: string;
  /** The score's own channel for it. */
  defaultChannel: number;
  /** Where the rack's map says it belongs, when the rack hosts something like it. */
  rackChannel?: number;
}

interface MidiPanelProps {
  samples: SampleEntry[];
  midi: MidiState;
  routes: RouteMap;
  onRouteChange: (sample: string, route: MidiRoute | undefined) => void;
  /** When the output selector is on Built-in, routing is parked. */
  disabled?: boolean;
  song?: CompiledSong | null;
  currentBeat?: number;
  playing?: boolean;

  // Master volume
  masterVolume?: number;
  onVolumeChange?: (volume: number) => void;

  outputMode?: 'builtin' | 'midi';
  onOutputModeChange?: (mode: 'builtin' | 'midi') => void;
  loop?: boolean;
  onLoopChange?: (loop: boolean) => void;
  metronome?: boolean;
  onMetronomeChange?: (on: boolean) => void;

  /**
   * The jukebox rack: its channel map and what it has reported ready.
   */
  rack?: RackSnapshot;
  /** True when `outputId` is the rack's port. */
  isRackPort?: (outputId: string) => boolean;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

/** The "Built-in synth" option needs a non-empty value: Radix reserves ''. */
const BUILTIN = '__builtin__';

export default function MidiPanel({
  samples,
  midi,
  routes,
  onRouteChange,
  disabled,
  song,
  currentBeat = 0,
  playing = false,
  masterVolume = 80,
  onVolumeChange,
  outputMode = 'builtin',
  onOutputModeChange,
  loop = true,
  onLoopChange,
  metronome = false,
  onMetronomeChange,
  rack = NO_RACK,
  isRackPort = () => false,
}: MidiPanelProps) {
  const rackByChannel = new Map(rack.channels.map((c) => [c.channel, c]));
  const outputById = new Map(midi.outputs.map((o) => [o.id, o]));

  const allAvailablePorts = useMemo(() => {
    return midi.outputs.map((o) => ({
      id: o.id,
      name: o.name || o.id,
      mpe: false,
    }));
  }, [midi.outputs]);

  const status = !midi.supported
    ? 'WebMIDI is not supported in this browser.'
    : midi.error
      ? midi.error
      : midi.outputs.length === 0
        ? 'No MIDI devices detected.'
        : null;

  const realTempo = calculateRealTempo(song, currentBeat);
  const liveTracks = getLiveTrackStates(song, currentBeat);

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
      {/* ── SECTION 0: OUTPUT ── */}
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-semibold">Output mode</span>
        </div>

        <ToggleGroup
          type="single"
          className="w-full"
          value={outputMode}
          onValueChange={(v) => v && onOutputModeChange?.(v as 'builtin' | 'midi')}
          aria-label="Output mode"
        >
          <ToggleGroupItem value="builtin" className="flex-1 text-xs">
            <Music2 />
            Built-in samples
          </ToggleGroupItem>
          <ToggleGroupItem value="midi" className="flex-1 border-l border-border text-xs">
            <Zap />
            Web MIDI
          </ToggleGroupItem>
        </ToggleGroup>

        <p className="mt-1.5 text-xs text-muted-foreground">
          {outputMode === 'builtin'
            ? 'The bundled sampler and synth, in this browser.'
            : 'The WebMIDI routes below, straight from this browser.'}
        </p>

        {/* Master volume */}
        <div className="mt-2.5 border-t border-border pt-2">
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
            <span className="flex items-center gap-1.5">
              <Volume2 className="size-3.5" /> Master volume
            </span>
            <span className="font-mono">{masterVolume}%</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[masterVolume]}
            onValueChange={([v]) => onVolumeChange?.(v)}
            aria-label="Master volume"
          />
        </div>

        <div className="mt-2.5 flex items-center gap-4 border-t border-border pt-2 text-xs">
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox checked={loop} onCheckedChange={(v) => onLoopChange?.(v === true)} aria-label="Loop" />
            Loop
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox
              checked={metronome}
              onCheckedChange={(v) => onMetronomeChange?.(v === true)}
              aria-label="Metronome"
            />
            Metronome
          </label>
        </div>
      </div>

      {/* ── SECTION 1: MIDI ROUTING ── */}
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">MIDI routing</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Send each instrument to a MIDI in. Unrouted ones play on the built-in orchestra.
        </p>
        {status && <p className="mt-2 text-xs text-warning">{status}</p>}
        {rack.available && (
          <p className="mt-2 text-xs text-muted-foreground">
            Rack on <span className="font-mono">{rack.through}</span>
            {rack.warming.length > 0 && (
              <span className="ml-1 text-warning">
                · warming ch {rack.warming.join(', ')}…
              </span>
            )}
          </p>
        )}
        {disabled && (
          <p className="mt-2 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-xs text-primary">
            Output is set to Built-in — everything plays on the bundled sampler
            &amp; synth. Switch the toggle above to Web MIDI to use these routes.
          </p>
        )}
      </div>

      <div
        className={cn(
          'border-b border-border px-4 py-3',
          disabled && 'pointer-events-none opacity-40',
        )}
      >
        {samples.length === 0 ? (
          <p className="text-xs text-muted-foreground">No instruments in the current score.</p>
        ) : (
          <ul className="space-y-3">
            {samples.map(({ name, defaultChannel, rackChannel }) => {
              const route = routes[name];
              const onRack = Boolean(route && isRackPort(route.outputId));
              const channelEntries = onRack && rack.channels.length > 0
                ? CHANNELS.map((ch) => {
                    const entry = rackByChannel.get(ch);
                    if (!entry) return { ch, label: `ch ${ch}: —` };
                    const mark = entry.ready === true ? '●' : entry.ready === false ? '○' : '◐';
                    return { ch, label: `ch ${ch}: ${entry.name} ${mark}` };
                  })
                : CHANNELS.map((ch) => ({ ch, label: `ch ${ch}` }));
              const suggested = rackChannel ?? defaultChannel;

              return (
                <li key={name}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium" title={name}>
                      {name}
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Select
                      value={route?.outputId ?? BUILTIN}
                      onValueChange={(value) => {
                        const outputId = value === BUILTIN ? '' : value;
                        const channel = route?.channel
                          ?? (outputId && isRackPort(outputId) ? suggested : defaultChannel);
                        onRouteChange(name, outputId ? { outputId, channel } : undefined);
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
                        {allAvailablePorts.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      disabled={!route}
                      value={String(route?.channel ?? suggested)}
                      onValueChange={(value) =>
                        route && onRouteChange(name, { ...route, channel: Number(value) })
                      }
                    >
                      <SelectTrigger
                        className="max-w-[140px]"
                        title="MIDI channel"
                        aria-label={`MIDI channel for ${name}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {channelEntries.map(({ ch, label }) => (
                          <SelectItem key={ch} value={String(ch)}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={!route || !outputById.has(route.outputId)}
                      onClick={() => {
                        if (!route) return;
                        const output = outputById.get(route.outputId);
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

      {/* ── SECTION 2: REAL TEMPO & LIVE TRACK MONITOR ── */}
      <div className="flex-1 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Track Monitor</h2>
          <span className="flex items-center gap-1.5 text-[11px] font-medium">
            {playing ? (
              <span className="flex items-center gap-1 text-primary">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                LIVE
              </span>
            ) : (
              <span className="text-muted-foreground">STOPPED</span>
            )}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Last played note, MIDI CC parameters &amp; real-time tempo calculation.
        </p>

        {/* Real Tempo Display Card */}
        <Card className="mt-3 shadow-inner">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Calculated Tempo
            </span>
            {realTempo.effectLabel && <Badge>{realTempo.effectLabel}</Badge>}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tracking-tight text-primary">
              {realTempo.bpm}
            </span>
            <span className="text-xs text-muted-foreground">BPM</span>
            {realTempo.baseBpm !== realTempo.bpm && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                (base: {realTempo.baseBpm} BPM)
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Transport Beat: {currentBeat.toFixed(2)}</span>
          </div>
        </Card>

        {/* Live Track Monitor List */}
        <div className="mt-4 space-y-3">
          {liveTracks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active tracks to monitor.</p>
          ) : (
            liveTracks.map((track) => {
              const { lastNote, expression, sustain, controls } = track;
              return (
                <Card
                  key={track.name}
                  className={cn(
                    'transition-colors',
                    lastNote?.isSounding && 'border-primary/50 bg-primary/5',
                  )}
                >
                  {/* Track Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          lastNote?.isSounding ? 'animate-pulse bg-primary' : 'bg-secondary',
                        )}
                      />
                      <span className="truncate text-xs font-semibold" title={track.name}>
                        {track.name}
                      </span>
                    </div>
                    <Badge variant="outline" className="normal-case">
                      ch {track.channel}
                    </Badge>
                  </div>

                  {/* Last Played Note Details */}
                  <div className="mt-2.5 rounded-md border border-border bg-card p-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[11px] text-muted-foreground">Last Note:</span>
                      {lastNote ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold">{lastNote.pitch}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            ({lastNote.midi})
                          </span>
                          {lastNote.isSounding && <Badge>Sounding</Badge>}
                        </div>
                      ) : (
                        <span className="font-mono text-[11px] text-muted-foreground">—</span>
                      )}
                    </div>
                    {lastNote && (
                      <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                        <span>vel: <strong className="text-foreground">{lastNote.velocity}</strong></span>
                        <span>dur: <strong className="text-foreground">{lastNote.duration}b</strong></span>
                        <span>at: <strong className="text-foreground">{lastNote.time}b</strong></span>
                      </div>
                    )}
                  </div>

                  {/* MIDI Parameters Grid */}
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="rounded-md border border-border bg-card p-1.5">
                      <div className="text-[10px] text-muted-foreground">Expression (CC11)</div>
                      <div className="mt-0.5 flex items-baseline justify-between font-mono">
                        <span className="font-semibold">{expression}</span>
                        <span className="text-[9px] text-muted-foreground">/ 127</span>
                      </div>
                    </div>

                    <div className="rounded-md border border-border bg-card p-1.5">
                      <div className="text-[10px] text-muted-foreground">Sustain (CC64)</div>
                      <div className="mt-0.5 flex items-baseline justify-between font-mono">
                        <span className={cn('font-semibold', sustain > 0 ? 'text-warning' : 'text-muted-foreground')}>
                          {sustain > 0 ? sustain : 'Off'}
                        </span>
                        {sustain > 0 && <span className="text-[9px] text-warning/80">PEDAL</span>}
                      </div>
                    </div>

                    {controls.map((ctrl) => (
                      <div key={ctrl.cc} className="rounded-md border border-border bg-card p-1.5">
                        <div className="truncate text-[10px] text-muted-foreground" title={`${ctrl.name} (CC${ctrl.cc})`}>
                          {ctrl.name}
                        </div>
                        <div className="mt-0.5 flex items-baseline justify-between font-mono">
                          <span className="font-semibold">{ctrl.value}</span>
                          <span className="text-[9px] text-muted-foreground">CC{ctrl.cc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
