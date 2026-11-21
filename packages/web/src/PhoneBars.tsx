/**
 * PhoneBars.tsx: the studio's frame on a phone.
 *
 * One row on top (the score, Share, GitHub, More), and two at the bottom, in
 * thumb reach: the player (Play, where the song is, Loop, Sound) over the four
 * tabs. While you type, both bottom rows give way to a row of the symbols the
 * format needs and the iOS keyboard hides two layers deep.
 */
import type { ComponentType, ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { EditorView } from '@codemirror/view';
import type { CompiledSong } from '@play.yaml/core';
import { ChevronDown, Code, Ellipsis, KeyboardMusic, Link2, Music, Play, Repeat, SlidersHorizontal, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateRealTempo } from './liveState';
import { GithubMark, HarmonyIcon } from './icons';

export type MainTab = 'editor' | 'roll' | 'score' | 'harmony';

const iconButton =
  'flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5';

interface HeaderProps {
  title: string;
  subtitle?: string;
  /** Unsaved or edited: an orange dot after the title. */
  edited: boolean;
  onOpenSongs: () => void;
  onShare: () => void;
  canShare: boolean;
  onOpenMore: () => void;
}

export function PhoneHeader({ title, subtitle, edited, onOpenSongs, onShare, canShare, onOpenMore }: HeaderProps) {
  return (
    <header className="flex h-[calc(3.25rem+env(safe-area-inset-top))] shrink-0 items-center gap-0.5 border-b border-border bg-card pt-[env(safe-area-inset-top)] pr-1.5 pl-1.5">
      <button
        type="button"
        aria-label={`Score: ${title}. Pick another`}
        onClick={onOpenSongs}
        className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 flex-col">
          {/* The dot stays outside the truncated title, so a long one can't hide it. */}
          <span className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold">
            <span className="truncate">{title}</span>
            {edited && (
              <span role="img" aria-label="edited" className="shrink-0 text-warning">
                ●
              </span>
            )}
          </span>
          {subtitle && <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <button type="button" aria-label="Share a link" onClick={onShare} disabled={!canShare} className={iconButton}>
        <Link2 />
      </button>
      <a
        href="https://github.com/flplima/play.yaml"
        target="_blank"
        rel="noreferrer"
        aria-label="Source on GitHub"
        className={iconButton}
      >
        <GithubMark />
      </a>
      <button type="button" aria-label="More" onClick={onOpenMore} className={iconButton}>
        <Ellipsis />
      </button>
    </header>
  );
}

/** Play and Stop: the one round button, yellow to start and red to stop. */
function PlayButton({ playing, disabled, onClick, small = false }: { playing: boolean; disabled: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      aria-label={playing ? 'Stop' : 'Play'}
      onClick={onClick}
      disabled={disabled}
      // The symbol row keeps the editor focused, so the keyboard stays up.
      onPointerDown={small ? (e) => e.preventDefault() : undefined}
      onMouseDown={small ? (e) => e.preventDefault() : undefined}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        small ? 'size-11' : 'size-12',
        playing ? 'bg-destructive' : 'bg-primary',
      )}
    >
      {playing ? <Square className="size-4 fill-current" /> : <Play className="size-5 translate-x-px fill-current" />}
    </button>
  );
}

interface PlayerProps {
  song: CompiledSong | null;
  playing: boolean;
  currentBeat: number;
  onPlay: () => void;
  onStop: () => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  onOpenSound: () => void;
}

export function PlayerBar({ song, playing, currentBeat, onPlay, onStop, loop, onLoopChange, onOpenSound }: PlayerProps) {
  const measure = Math.max(1, song?.measureBeats ?? 4);
  const length = song?.lengthBeats ?? 0;
  const bars = Math.max(1, Math.ceil(length / measure));
  const beat = Math.max(0, currentBeat);
  const bar = Math.min(bars, Math.floor(beat / measure) + 1);
  const progress = playing && length > 0 ? Math.min(1, beat / length) : 0;
  const tempo = calculateRealTempo(song, beat);

  return (
    <section aria-label="Player" className="relative flex h-16 shrink-0 items-center gap-2.5 border-t border-border bg-card pr-1.5 pl-3">
      <div aria-hidden="true" className="absolute inset-x-0 -top-px h-[3px] bg-secondary">
        <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
      </div>
      <PlayButton playing={playing} disabled={!playing && !song} onClick={playing ? onStop : onPlay} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px]">
          {!song ? 'Nothing to play' : playing ? `bar ${bar} of ${bars}` : `${bars} ${bars === 1 ? 'bar' : 'bars'}`}
        </span>
        {song && (
          <span className="truncate text-[11px] text-muted-foreground">
            {tempo.bpm} bpm{tempo.effectLabel ? ` · ${tempo.effectLabel}` : ''}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Loop"
        aria-pressed={loop}
        onClick={() => onLoopChange(!loop)}
        className={cn(iconButton, loop ? 'bg-primary/15 text-primary hover:bg-primary/25' : 'text-muted-foreground')}
      >
        <Repeat />
      </button>
      <button type="button" aria-label="Sound settings" onClick={onOpenSound} className={iconButton}>
        <SlidersHorizontal />
      </button>
    </section>
  );
}

const TABS: [MainTab, string, ComponentType<{ className?: string }>][] = [
  ['editor', 'Code', Code],
  ['roll', 'Roll', KeyboardMusic],
  ['score', 'Score', Music],
  ['harmony', 'Harmony', HarmonyIcon],
];

/** The four views as a bottom tab bar. It is the same Radix tab list as the desktop's, so it must sit inside <Tabs>. */
export function PhoneTabBar() {
  return (
    <TabsPrimitive.List
      aria-label="Views"
      className="grid shrink-0 grid-cols-4 border-t border-secondary bg-card pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map(([id, label, Icon]) => (
        <TabsPrimitive.Trigger
          key={id}
          value={id}
          className="flex h-14 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[state=active]:text-primary"
        >
          <Icon className="size-[22px]" />
          {label}
        </TabsPrimitive.Trigger>
      ))}
    </TabsPrimitive.List>
  );
}

/**
 * The characters a score is made of that the iOS keyboard keeps two taps away
 * (on its "#+=" page): quotes, groups, holds, rests, comments.
 */
const SYMBOLS = ['"', '{', '}', ':', '-', '~', '_', '#', '[', ']', ','];

interface SymbolBarProps {
  view: () => EditorView | null;
  playing: boolean;
  canPlay: boolean;
  onPlay: () => void;
  onStop: () => void;
}

/** Sits on top of the on-screen keyboard while the editor has focus. */
export function SymbolBar({ view, playing, canPlay, onPlay, onStop }: SymbolBarProps) {
  const type = (text: string) => {
    const v = view();
    if (!v) return;
    v.dispatch(v.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input.type' });
  };
  // Every button here keeps the editor focused: a tap that moved focus would close the keyboard.
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <div role="toolbar" aria-label="Symbols" className="flex h-12 shrink-0 items-center gap-0.5 border-t border-border bg-card px-1">
      <PlayButton small playing={playing} disabled={!playing && !canPlay} onClick={playing ? onStop : onPlay} />
      <div aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />
      <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto overscroll-contain [scrollbar-width:none]">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            type="button"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => type(s)}
            className="h-11 w-9.5 shrink-0 rounded-md bg-secondary text-base text-foreground active:bg-accent"
          >
            {s}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label="Hide the keyboard"
        onClick={() => view()?.contentDOM.blur()}
        className={iconButton}
      >
        <ChevronDown />
      </button>
    </div>
  );
}

/** A row in a sheet: an on/off switch with its label, 52 px tall. */
export function SwitchRow({ label, hint, checked, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-13 w-full items-center justify-between gap-3 border-b border-secondary text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-accent')}
      >
        <span
          className={cn(
            'absolute top-[3px] size-[22px] rounded-full transition-[left] motion-reduce:transition-none',
            checked ? 'left-[23px] bg-primary-foreground' : 'left-[3px] bg-muted-foreground',
          )}
        />
      </span>
    </button>
  );
}
