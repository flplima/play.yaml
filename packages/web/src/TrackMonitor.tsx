import type { CompiledSong } from '@play.yaml/core';
import { calculateRealTempo, getLiveTrackStates } from './liveState';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

interface Props {
  song: CompiledSong | null;
  currentBeat: number;
  playing: boolean;
}

export default function TrackMonitor({ song, currentBeat, playing }: Props) {
  const realTempo = calculateRealTempo(song, currentBeat);
  const liveTracks = getLiveTrackStates(song, currentBeat);

  return (
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

      <Card className="mt-3 shadow-inner">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Calculated Tempo</span>
          {realTempo.effectLabel && <Badge>{realTempo.effectLabel}</Badge>}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tracking-tight text-primary">{realTempo.bpm}</span>
          <span className="text-xs text-muted-foreground">BPM</span>
          {realTempo.baseBpm !== realTempo.bpm && (
            <span className="ml-auto text-[11px] text-muted-foreground">(base: {realTempo.baseBpm} BPM)</span>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Transport Beat: {currentBeat.toFixed(2)}</span>
        </div>
      </Card>

      <div className="mt-4 space-y-3">
        {liveTracks.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active tracks to monitor.</p>
        ) : (
          liveTracks.map((track) => {
            const { lastNote, expression, sustain, controls } = track;
            return (
              <Card
                key={track.name}
                className={cn('transition-colors', lastNote?.isSounding && 'border-primary/50 bg-primary/5')}
              >
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

                <div className="mt-2.5 rounded-md border border-border bg-card p-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[11px] text-muted-foreground">Last Note:</span>
                    {lastNote ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold">{lastNote.pitch}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">({lastNote.midi})</span>
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
  );
}
