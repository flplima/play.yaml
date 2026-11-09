import { Music2, Volume2, Zap } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/** Where playback goes: the bundled sampler/synth, or the WebMIDI routes. */
export type OutputMode = 'builtin' | 'midi';

interface Props {
  outputMode: OutputMode;
  onOutputModeChange: (mode: OutputMode) => void;
  /** 0–100. */
  masterVolume: number;
  onVolumeChange: (volume: number) => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  metronome: boolean;
  onMetronomeChange: (on: boolean) => void;
}

export default function OutputPanel(p: Props) {
  return (
    <div className="border-b border-border bg-card px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-semibold">Output mode</span>
      </div>

      <ToggleGroup
        type="single"
        className="w-full"
        value={p.outputMode}
        onValueChange={(v) => v && p.onOutputModeChange(v as OutputMode)}
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
        {p.outputMode === 'builtin'
          ? 'The bundled sampler and synth, in this browser.'
          : 'The WebMIDI routes below, straight from this browser.'}
      </p>

      <div className="mt-2.5 border-t border-border pt-2">
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
          <span className="flex items-center gap-1.5">
            <Volume2 className="size-3.5" /> Master volume
          </span>
          <span className="font-mono">{p.masterVolume}%</span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[p.masterVolume]}
          onValueChange={([v]) => p.onVolumeChange(v)}
          aria-label="Master volume"
        />
      </div>

      <div className="mt-2.5 flex items-center gap-4 border-t border-border pt-2 text-xs">
        <label className="flex cursor-pointer items-center gap-1.5">
          <Checkbox checked={p.loop} onCheckedChange={(v) => p.onLoopChange(v === true)} aria-label="Loop" />
          Loop
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <Checkbox
            checked={p.metronome}
            onCheckedChange={(v) => p.onMetronomeChange(v === true)}
            aria-label="Metronome"
          />
          Metronome
        </label>
      </div>
    </div>
  );
}
