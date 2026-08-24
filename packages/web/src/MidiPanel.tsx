import { useMemo } from 'react';
import { MonitorSpeaker, Music2, RefreshCw, TriangleAlert, Volume2, Zap } from 'lucide-react';
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

import {
  IDLE_PREPARED, NO_RACK, type PreparedStatus, type RackSnapshot, type ServerPortInfo,
} from './serverPlayback';

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

  /*
   * Output configuration. This all used to live in the navbar; it is
   * configuration rather than transport, so it sits with the routing it
   * governs instead of beside the play button.
   */
  outputMode?: 'builtin' | 'midi' | 'server';
  onOutputModeChange?: (mode: 'builtin' | 'midi' | 'server') => void;
  /** Where a server-rendered track is heard. Only meaningful on Server MIDI. */
  speaker?: 'server' | 'client';
  onSpeakerChange?: (speaker: 'server' | 'client') => void;
  /** The server's standing render — the thing Play will start. */
  prepared?: PreparedStatus;
  /** False while this browser is still pulling that render down. */
  clientAudioReady?: boolean;
  onRefreshPrepared?: () => void;
  loop?: boolean;
  onLoopChange?: (loop: boolean) => void;
  metronome?: boolean;
  onMetronomeChange?: (on: boolean) => void;

  // Server-side mode props
  serverSideMode?: boolean;
  serverMidiDevice?: string;
  onServerMidiDeviceChange?: (device: string) => void;
  serverMidiDevices?: string[];
  serverPortsInfo?: ServerPortInfo[];
  onRefreshServerDevices?: () => void;
  serverAvailable?: boolean;
  serverError?: string | null;
  onServerTestNote?: (device: string, channel: number) => void;

  /**
   * The jukebox rack, whichever side is playing: its channel map and what it
   * has reported ready. Channel pickers on the rack's port are labelled from
   * it, and a routed instrument lands on the channel the map suggests.
   */
  rack?: RackSnapshot;
  /** True when `outputId` is the rack's port. */
  isRackPort?: (outputId: string) => boolean;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

/** The "Built-in synth" option needs a non-empty value: Radix reserves ''. */
const BUILTIN = '__builtin__';

function clock(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** One line describing the standing render, for the Speaker section. */
function preparedLabelFor(
  prepared: PreparedStatus,
  clientAudioReady: boolean,
  speaker: 'server' | 'client',
): { label: string; tone: 'idle' | 'busy' | 'ready' | 'warn' | 'error' } {
  switch (prepared.status) {
    case 'rendering':
      return { label: `Rendering… ${Math.round(prepared.progress * 100)}%`, tone: 'busy' };
    case 'error':
      return { label: `Render failed — ${prepared.error ?? 'unknown error'}`, tone: 'error' };
    case 'ready':
      /*
       * A score whose every track is routed out to a MIDI port renders no
       * audio here at all — the rack at the other end of the cable is what
       * sounds. Ordinary on Server speaker, but on Client it is the whole
       * answer to "why is it still coming out of the server?", so it is said
       * plainly rather than left as a grey aside: no setting in this panel can
       * move audio a downstream synth is producing.
       */
      if (!prepared.hasAudio) {
        return speaker === 'client'
          ? {
            label: 'Nothing to send — every track goes out as MIDI, so the rack sounds on the server',
            tone: 'warn',
          }
          : { label: 'No audio to render — every track goes out as MIDI', tone: 'idle' };
      }
      if (!clientAudioReady) return { label: 'Sending the render to this browser…', tone: 'busy' };
      return {
        label: `Ready · ${clock(prepared.durationSec)}${speaker === 'client' ? ' · here' : ''}`,
        tone: 'ready',
      };
    default:
      return { label: 'Nothing rendered yet', tone: 'idle' };
  }
}

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
  speaker = 'server',
  onSpeakerChange,
  prepared = IDLE_PREPARED,
  clientAudioReady = true,
  onRefreshPrepared,
  loop = true,
  onLoopChange,
  metronome = false,
  onMetronomeChange,
  serverSideMode = false,
  serverMidiDevice = 'Server Audio Output (Web Audio)',
  onServerMidiDeviceChange,
  serverMidiDevices = ['Server Audio Output (Web Audio)'],
  serverPortsInfo = [],
  onRefreshServerDevices,
  serverAvailable = false,
  serverError = null,
  onServerTestNote,
  rack = NO_RACK,
  isRackPort = () => false,
}: MidiPanelProps) {
  const rackByChannel = new Map(rack.channels.map((c) => [c.channel, c]));
  const outputById = new Map(midi.outputs.map((o) => [o.id, o]));
  const portsInfoById = new Map(serverPortsInfo.map((p) => [p.id, p]));
  const preparedState = preparedLabelFor(prepared, clientAudioReady, speaker);

  const findPortInfo = (outputId?: string): ServerPortInfo | undefined => {
    if (!outputId) return undefined;
    let match = portsInfoById.get(outputId);
    if (match) return match;
    match = serverPortsInfo.find((p) => p.rawName === outputId || p.id === outputId);
    if (match) return match;
    return serverPortsInfo.find(
      (p) =>
        (p.id && (p.id.includes(outputId) || outputId.includes(p.id))) ||
        (p.rawName && (p.rawName.includes(outputId) || outputId.includes(p.rawName))),
    );
  };

  // The routable ports depend on which machine is going to play: the server's
  // own ports in server mode, this browser's WebMIDI outputs otherwise. Mixing
  // them would offer routes the playing side cannot honour.
  const allAvailablePorts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; mpe: boolean }>();

    if (serverSideMode) {
      for (const p of serverPortsInfo) {
        map.set(p.id, { id: p.id, name: `${p.name}${p.mpe ? ' [MPE]' : ''}`, mpe: p.mpe });
      }
      return Array.from(map.values());
    }

    // WebMIDI outputs, wearing the server's names for them where one matches.
    for (const o of midi.outputs) {
      const match = findPortInfo(o.id) || findPortInfo(o.name || undefined);
      map.set(o.id, {
        id: o.id,
        name: match ? `${match.name}${match.mpe ? ' [MPE]' : ''}` : o.name || o.id,
        mpe: Boolean(match?.mpe),
      });
    }

    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSideMode, serverPortsInfo, midi.outputs]);

  const status = !midi.supported
    ? 'WebMIDI is not supported in this browser.'
    : midi.error
      ? midi.error
      : midi.outputs.length === 0
        ? 'No MIDI ins detected.'
        : null;

  const realTempo = calculateRealTempo(song, currentBeat);
  const liveTracks = getLiveTrackStates(song, currentBeat);

  const selectedServerPort = findPortInfo(serverMidiDevice);

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
      {/* ── SECTION 0: OUTPUT ── the configuration the navbar used to hold ── */}
      <div className="border-b border-border bg-server/5 px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-semibold">Output mode</span>
          {serverSideMode && (
            <Badge variant="server" className={playing ? 'animate-pulse' : undefined}>
              Server
            </Badge>
          )}
        </div>

        <ToggleGroup
          type="single"
          className="w-full"
          value={outputMode}
          onValueChange={(v) => v && onOutputModeChange?.(v as 'builtin' | 'midi' | 'server')}
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
          <ToggleGroupItem
            value="server"
            className="flex-1 border-l border-border text-xs data-[state=on]:bg-server/20 data-[state=on]:text-server"
          >
            <MonitorSpeaker />
            Server MIDI
          </ToggleGroupItem>
        </ToggleGroup>

        <p className="mt-1.5 text-xs text-muted-foreground">
          {outputMode === 'builtin'
            ? 'The bundled sampler and synth, in this browser.'
            : outputMode === 'midi'
              ? 'The WebMIDI routes below, straight from this browser.'
              : "The server's own MIDI ports — the VST rack."}
        </p>

        {serverSideMode && (
          <div className="mt-2.5 border-t border-server/25 pt-2">
            <div className="mb-1.5 text-xs font-medium text-server">Speaker</div>
            <ToggleGroup
              type="single"
              className="w-full"
              value={speaker}
              onValueChange={(v) => v && onSpeakerChange?.(v as 'server' | 'client')}
              aria-label="Speaker"
            >
              <ToggleGroupItem value="server" className="flex-1 text-xs">
                <MonitorSpeaker />
                Server
              </ToggleGroupItem>
              <ToggleGroupItem value="client" className="flex-1 border-l border-border text-xs">
                <Volume2 />
                Client
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {speaker === 'server'
                ? "Rendered audio plays on the server's own speakers."
                : 'Rendered on the server and streamed here, to this browser.'}
            </p>

            {/*
              The render is made when the score settles, not when Play is
              pressed, so its state has to be visible: this is what says
              whether Play will start instantly or have to wait. The refresh
              button throws it away and builds it again — for when the sound
              changed underneath the score (a sample library, a rack preset)
              and the server cannot know the render is stale.
            */}
            <div
              className={cn(
                'mt-2 flex items-start gap-2 rounded-md px-2 py-1.5',
                preparedState.tone === 'warn' ? 'bg-warning/15' : 'bg-muted/40',
              )}
            >
              <span
                className={cn(
                  'mt-1 size-1.5 shrink-0 rounded-full',
                  preparedState.tone === 'ready'
                    ? 'bg-primary'
                    : preparedState.tone === 'busy'
                      ? 'bg-warning animate-pulse'
                      : preparedState.tone === 'warn'
                        ? 'bg-warning'
                        : preparedState.tone === 'error'
                          ? 'bg-destructive'
                          : 'bg-muted-foreground',
                )}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 text-xs',
                  // The one state that is a dead end gets to wrap and be read;
                  // the rest are short and stay on their line.
                  preparedState.tone === 'warn'
                    ? 'text-warning'
                    : 'truncate text-muted-foreground',
                )}
                title={prepared.error ?? undefined}
              >
                {preparedState.label}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-server hover:text-server"
                onClick={onRefreshPrepared}
                aria-label="Re-render the audio output"
                title="Re-render the audio output"
              >
                <RefreshCw className={cn('size-3', prepared.status === 'rendering' && 'animate-spin')} />
              </Button>
            </div>
          </div>
        )}

        {/* Master volume */}
        <div className="mt-2.5 border-t border-server/25 pt-2">
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

        {serverSideMode && (
          <Card className="mt-3 space-y-2 border-server/40">
            <div className="flex items-center justify-between text-xs font-medium text-server">
              <span>Server MIDI / Audio Output:</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px] text-server hover:text-server"
                onClick={onRefreshServerDevices}
                title="Refresh server MIDI devices"
              >
                <RefreshCw />
                Refresh
              </Button>
            </div>

            <Select value={serverMidiDevice} onValueChange={(v) => onServerMidiDeviceChange?.(v)}>
              <SelectTrigger className="w-full border-server/40 font-mono" aria-label="Server MIDI / audio output">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {serverPortsInfo.length > 0
                  ? serverPortsInfo.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} {p.mpe ? '[MPE]' : ''}
                      </SelectItem>
                    ))
                  : serverMidiDevices.map((dev) => (
                      <SelectItem key={dev} value={dev}>
                        {dev}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>

            {selectedServerPort && (
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-muted-foreground">{selectedServerPort.name}</span>
                {selectedServerPort.mpe && <Badge>MPE enabled</Badge>}
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  serverAvailable ? 'bg-primary' : 'bg-warning',
                )}
              />
              <span>{serverAvailable ? 'Live stream connected' : 'Reconnecting to server…'}</span>
            </div>

            {serverError && (
              <div className="flex items-center gap-1.5 text-[10px] text-warning">
                <TriangleAlert className="size-3 shrink-0" />
                {serverError}
              </div>
            )}
          </Card>
        )}
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
            &amp; synth. Switch the header toggle to MIDI to use these routes.
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
              const selectedPortInfo = route ? findPortInfo(route.outputId) : undefined;
              const isMpe = selectedPortInfo?.mpe === true;
              const onRack = Boolean(route && isRackPort(route.outputId));
              // On the rack's port every channel is named by what is on it,
              // and marked with what the rack last said about it: ● will
              // sound, ○ not loaded yet (a lazy rack loads it on the first
              // note — or on Play, which warms it first).
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
                    {isMpe && <Badge>MPE</Badge>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Select
                      value={route?.outputId ?? BUILTIN}
                      onValueChange={(value) => {
                        const outputId = value === BUILTIN ? '' : value;
                        // A route onto the rack lands where the rack's map
                        // says this instrument lives; anywhere else keeps
                        // the score's own channel.
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
                      disabled={!route || isMpe}
                      value={String(isMpe ? 1 : (route?.channel ?? suggested))}
                      onValueChange={(value) =>
                        route && onRouteChange(name, { ...route, channel: Number(value) })
                      }
                    >
                      <SelectTrigger
                        className="max-w-[140px]"
                        title={isMpe ? 'Channel selection disabled for MPE ports' : 'MIDI channel'}
                        aria-label={`MIDI channel for ${name}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {isMpe ? (
                          <SelectItem value="1">MPE (Zone 1-16)</SelectItem>
                        ) : (
                          channelEntries.map(({ ch, label }) => (
                            <SelectItem key={ch} value={String(ch)}>
                              {label}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={
                        !route ||
                        (serverSideMode
                          ? !portsInfoById.has(route.outputId)
                          : !outputById.has(route.outputId))
                      }
                      onClick={() => {
                        if (!route) return;
                        // In server mode the note has to be struck by the
                        // machine that owns the port, not by this browser.
                        if (serverSideMode) {
                          onServerTestNote?.(route.outputId, isMpe ? 1 : route.channel);
                          return;
                        }
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
