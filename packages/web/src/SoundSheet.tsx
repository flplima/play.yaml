import type { ReactNode } from 'react';
import { Slider } from '@/components/ui/slider';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { OutputMode } from './OutputPanel';
import { SwitchRow } from './PhoneBars';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** False where the browser has no Web MIDI (iOS Safari): the choice is hidden, with a line saying why. */
  midiSupported: boolean;
  outputMode: OutputMode;
  onOutputModeChange: (mode: OutputMode) => void;
  /** 0 to 100. */
  masterVolume: number;
  onVolumeChange: (volume: number) => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  metronome: boolean;
  onMetronomeChange: (on: boolean) => void;
  /** The MIDI routing, shown while the output is Web MIDI. */
  routing: ReactNode;
  /** The track monitor: tempo, last notes and controllers. */
  monitor: ReactNode;
}

/** The desktop side panel, as a phone sheet: where the sound goes and how loud. */
export default function SoundSheet(p: Props) {
  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent title="Sound" className="h-[min(44rem,calc(100dvh-3.5rem))]">
        <div className="flex flex-col gap-4 px-4 pb-4">
          {p.midiSupported ? (
            <div role="radiogroup" aria-label="Plays on" className="grid grid-cols-2 gap-0.5 rounded-xl border border-border p-0.5">
              {(
                [
                  ['builtin', 'Built-in sounds'],
                  ['midi', 'Web MIDI'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={p.outputMode === mode}
                  onClick={() => p.onOutputModeChange(mode)}
                  className={cn(
                    'h-11 rounded-[10px] text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    p.outputMode === mode ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-border px-3.5 py-3 text-xs text-muted-foreground">
              Plays on the built-in sounds. This browser has no Web MIDI, so it can't reach your synths.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span id="sound-volume">Volume</span>
              <span className="text-foreground">{p.masterVolume}%</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[p.masterVolume]}
              onValueChange={([v]) => p.onVolumeChange(v)}
              aria-labelledby="sound-volume"
              // A thumb-sized hit area and knob; Radix jumps to wherever you touch the track.
              className="h-11 [&_[role=slider]]:size-6"
            />
          </div>

          <div className="flex flex-col border-t border-secondary">
            <SwitchRow label="Loop the song" checked={p.loop} onChange={p.onLoopChange} />
            <SwitchRow label="Metronome" checked={p.metronome} onChange={p.onMetronomeChange} />
          </div>
        </div>
        {p.midiSupported && p.outputMode === 'midi' && p.routing}
        {p.monitor}
      </SheetContent>
    </Sheet>
  );
}
