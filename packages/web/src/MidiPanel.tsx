import { useMemo } from 'react';
import type { CompiledSong } from '@play.yaml/core';
import type { MidiState } from './useMidi';
import type { MidiRoute, RouteMap } from './player';
import { sendTestNote } from './player';
import { calculateRealTempo, getLiveTrackStates } from './trackMonitor';

import type { ServerPortInfo } from './serverPlayback';

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
  /** When the output selector is on Built-in, routing is parked. */
  disabled?: boolean;
  song?: CompiledSong | null;
  currentBeat?: number;
  playing?: boolean;

  // Master volume
  masterVolume?: number;
  onVolumeChange?: (volume: number) => void;

  // Server-side mode props
  serverSideMode?: boolean;
  onServerSideModeChange?: (active: boolean) => void;
  serverMidiDevice?: string;
  onServerMidiDeviceChange?: (device: string) => void;
  serverMidiDevices?: string[];
  serverPortsInfo?: ServerPortInfo[];
  onRefreshServerDevices?: () => void;
  serverAvailable?: boolean;
  serverError?: string | null;
  onServerTestNote?: (device: string, channel: number) => void;
}

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

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
  serverSideMode = false,
  onServerSideModeChange,
  serverMidiDevice = 'Server Audio Output (Web Audio)',
  onServerMidiDeviceChange,
  serverMidiDevices = ['Server Audio Output (Web Audio)'],
  serverPortsInfo = [],
  onRefreshServerDevices,
  serverAvailable = false,
  serverError = null,
  onServerTestNote,
}: MidiPanelProps) {
  const outputById = new Map(midi.outputs.map((o) => [o.id, o]));
  const portsInfoById = new Map(serverPortsInfo.map((p) => [p.id, p]));

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

    // WebMIDI outputs, wearing their config.yaml names where one matches.
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
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-900">
      {/* ── SECTION 0: SERVER SIDE PLAYBACK & VOLUME ── */}
      <div className="border-b border-zinc-800 px-4 py-3 bg-purple-950/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-purple-200">Server Side Mode</span>
            {serverSideMode && (
              <span className="rounded bg-purple-500/20 border border-purple-500/40 px-1.5 py-0.5 text-[10px] font-bold text-purple-300 animate-pulse">
                ACTIVE
              </span>
            )}
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={serverSideMode}
              onChange={(e) => onServerSideModeChange?.(e.target.checked)}
            />
            <div className="peer h-5 w-9 rounded-full bg-zinc-700 after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-purple-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
          </label>
        </div>

        <p className="mt-1 text-xs text-zinc-400">
          Play music through server speakers or server hardware MIDI devices.
        </p>

        {/* Master Volume Slider */}
        <div className="mt-2.5 pt-2 border-t border-purple-900/40">
          <div className="flex items-center justify-between text-xs text-purple-200 mb-1 font-medium">
            <span className="flex items-center gap-1">
              🔊 Master Volume
            </span>
            <span className="font-mono text-purple-300">{masterVolume}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={masterVolume}
            onChange={(e) => onVolumeChange?.(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer accent-purple-500 rounded bg-zinc-800"
            title="Adjust master volume for client and server playback"
          />
        </div>

        {serverSideMode && (
          <div className="mt-3 space-y-2 rounded-lg border border-purple-900/60 bg-zinc-950/60 p-2.5">
            <div className="flex items-center justify-between text-xs text-purple-300 font-medium">
              <span>Server MIDI / Audio Output:</span>
              <button
                className="text-[10px] text-purple-400 hover:text-purple-200 underline"
                onClick={onRefreshServerDevices}
                title="Refresh server MIDI devices"
              >
                ↻ Refresh
              </button>
            </div>

            <div className="relative">
              <select
                className="w-full rounded border border-purple-800/60 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 font-mono focus:border-purple-500 focus:outline-none"
                value={serverMidiDevice}
                onChange={(e) => onServerMidiDeviceChange?.(e.target.value)}
              >
                {serverPortsInfo.length > 0
                  ? serverPortsInfo.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.mpe ? '[MPE]' : ''}
                      </option>
                    ))
                  : serverMidiDevices.map((dev) => (
                      <option key={dev} value={dev}>
                        {dev}
                      </option>
                    ))}
              </select>
            </div>

            {selectedServerPort && (
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-zinc-400 truncate">{selectedServerPort.name}</span>
                {selectedServerPort.mpe && (
                  <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300 border border-indigo-500/40">
                    MPE ENABLED
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
              <span className={`h-1.5 w-1.5 rounded-full ${serverAvailable ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span>{serverAvailable ? 'Live stream connected' : 'Reconnecting to server…'}</span>
            </div>

            {serverError && <div className="text-[10px] text-amber-400">⚠ {serverError}</div>}
          </div>
        )}
      </div>

      {/* ── SECTION 1: MIDI ROUTING ── */}
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-200">MIDI routing</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Send each instrument to a MIDI in. Unrouted ones play on the built-in synth.
        </p>
        {status && <p className="mt-2 text-xs text-amber-400">{status}</p>}
        {disabled && (
          <p className="mt-2 rounded border border-emerald-900 bg-emerald-950/40 px-2 py-1.5 text-xs text-emerald-400">
            Output is set to Built-in — everything plays on the bundled sampler
            &amp; synth. Switch the header toggle to MIDI to use these routes.
          </p>
        )}
      </div>

      <div className={disabled ? 'pointer-events-none border-b border-zinc-800 px-4 py-3 opacity-40' : 'border-b border-zinc-800 px-4 py-3'}>
        {samples.length === 0 ? (
          <p className="text-xs text-zinc-500">No instruments in the current score.</p>
        ) : (
          <ul className="space-y-3">
            {samples.map(({ name, defaultChannel }) => {
              const route = routes[name];
              const selectedPortInfo = route ? findPortInfo(route.outputId) : undefined;
              const isMpe = selectedPortInfo?.mpe === true;
              const channelEntries = selectedPortInfo?.channels && Object.keys(selectedPortInfo.channels).length > 0
                ? Object.entries(selectedPortInfo.channels).map(([chStr, instName]) => ({
                    ch: Number(chStr),
                    label: `ch ${chStr}: ${instName}`,
                  }))
                : CHANNELS.map((ch) => ({ ch, label: `ch ${ch}` }));

              return (
                <li key={name}>
                  <div className="flex items-center justify-between">
                    <div className="truncate text-sm font-medium text-zinc-200" title={name}>
                      {name}
                    </div>
                    {isMpe && (
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300 border border-indigo-500/40">
                        MPE
                      </span>
                    )}
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
                      {allAvailablePorts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-200 disabled:opacity-40 max-w-[140px] truncate"
                      disabled={!route || isMpe}
                      value={isMpe ? 1 : (route?.channel ?? defaultChannel)}
                      onChange={(e) =>
                        route && onRouteChange(name, { ...route, channel: Number(e.target.value) })
                      }
                      title={isMpe ? 'Channel selection disabled for MPE ports' : 'MIDI channel'}
                    >
                      {isMpe ? (
                        <option value={1}>MPE (Zone 1-16)</option>
                      ) : (
                        channelEntries.map(({ ch, label }) => (
                          <option key={ch} value={ch}>
                            {label}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
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
                    </button>
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
          <h2 className="text-sm font-semibold text-zinc-200">Track Monitor</h2>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
            {playing ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                LIVE
              </span>
            ) : (
              <span className="text-zinc-500">STOPPED</span>
            )}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Last played note, MIDI CC parameters &amp; real-time tempo calculation.
        </p>

        {/* Real Tempo Display Card */}
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 shadow-inner">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider text-zinc-400">Calculated Tempo</span>
            {realTempo.effectLabel && (
              <span className="rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-800/50">
                {realTempo.effectLabel}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-emerald-400">
              {realTempo.bpm}
            </span>
            <span className="text-xs text-zinc-400">BPM</span>
            {realTempo.baseBpm !== realTempo.bpm && (
              <span className="ml-auto text-[11px] text-zinc-500">
                (base: {realTempo.baseBpm} BPM)
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
            <span>Transport Beat: {currentBeat.toFixed(2)}</span>
          </div>
        </div>

        {/* Live Track Monitor List */}
        <div className="mt-4 space-y-3">
          {liveTracks.length === 0 ? (
            <p className="text-xs text-zinc-500">No active tracks to monitor.</p>
          ) : (
            liveTracks.map((track) => {
              const { lastNote, expression, sustain, controls } = track;
              return (
                <div
                  key={track.name}
                  className={`rounded-lg border p-3 transition-colors ${
                    lastNote?.isSounding
                      ? 'border-emerald-500/50 bg-emerald-950/20 shadow-sm shadow-emerald-950/30'
                      : 'border-zinc-800 bg-zinc-950/40'
                  }`}
                >
                  {/* Track Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          lastNote?.isSounding ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-700'
                        }`}
                      />
                      <span className="truncate text-xs font-semibold text-zinc-200" title={track.name}>
                        {track.name}
                      </span>
                    </div>
                    <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      ch {track.channel}
                    </span>
                  </div>

                  {/* Last Played Note Details */}
                  <div className="mt-2.5 rounded bg-zinc-900/80 p-2 border border-zinc-800/80">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500 text-[11px]">Last Note:</span>
                      {lastNote ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-zinc-100">{lastNote.pitch}</span>
                          <span className="text-[10px] text-zinc-500 font-mono">({lastNote.midi})</span>
                          {lastNote.isSounding && (
                            <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[9px] font-semibold text-emerald-300">
                              SOUNDING
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-600 font-mono text-[11px]">—</span>
                      )}
                    </div>
                    {lastNote && (
                      <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                        <span>vel: <strong className="text-zinc-200">{lastNote.velocity}</strong></span>
                        <span>dur: <strong className="text-zinc-200">{lastNote.duration}b</strong></span>
                        <span>at: <strong className="text-zinc-200">{lastNote.time}b</strong></span>
                      </div>
                    )}
                  </div>

                  {/* MIDI Parameters Grid */}
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="rounded bg-zinc-900/50 p-1.5 border border-zinc-800/50">
                      <div className="text-[10px] text-zinc-500">Expression (CC11)</div>
                      <div className="mt-0.5 flex items-baseline justify-between font-mono">
                        <span className="font-semibold text-zinc-200">{expression}</span>
                        <span className="text-[9px] text-zinc-500">/ 127</span>
                      </div>
                    </div>

                    <div className="rounded bg-zinc-900/50 p-1.5 border border-zinc-800/50">
                      <div className="text-[10px] text-zinc-500">Sustain (CC64)</div>
                      <div className="mt-0.5 flex items-baseline justify-between font-mono">
                        <span className={`font-semibold ${sustain > 0 ? 'text-amber-300' : 'text-zinc-400'}`}>
                          {sustain > 0 ? sustain : 'Off'}
                        </span>
                        {sustain > 0 && <span className="text-[9px] text-amber-500/80">PEDAL</span>}
                      </div>
                    </div>

                    {controls.map((ctrl) => (
                      <div key={ctrl.cc} className="rounded bg-zinc-900/50 p-1.5 border border-zinc-800/50">
                        <div className="text-[10px] text-zinc-500 truncate" title={`${ctrl.name} (CC${ctrl.cc})`}>
                          {ctrl.name}
                        </div>
                        <div className="mt-0.5 flex items-baseline justify-between font-mono">
                          <span className="font-semibold text-zinc-200">{ctrl.value}</span>
                          <span className="text-[9px] text-zinc-500">CC{ctrl.cc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
