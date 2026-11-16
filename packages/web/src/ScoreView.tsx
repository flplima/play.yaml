/**
 * ScoreView.tsx: the score as paginated sheet music.
 *
 * The editor says what a score is made of, the roll shows what it does, and
 * this shows it the way a musician would be handed it. Pages are rendered by
 * OpenSheetMusicDisplay (see score.ts) into white cards on the dark app, and while the song
 * plays the notes sounding at the transport's beat are coloured.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';
import { activeAt, renderScore, scoreXml, RenderedScore } from './score';
import { Button } from '@/components/ui/button';

interface Props {
  text: string;
  /** Rendering waits until the tab is on screen: the engine is heavy and a hidden tab costs nothing. */
  visible: boolean;
  playing: boolean;
  /** Transport position in quarter beats. */
  currentBeat: number;
}

/** Wait this long after the last keystroke before engraving again. */
const DEBOUNCE_MS = 500;

/** A page's SVG is a few hundred KB of markup: leave it alone unless the string changed. */
const Page = memo(function Page({ svg, index }: { svg: string; index: number }) {
  return (
    <div
      className="score-paper w-full shadow-lg shadow-black/40"
      role="img"
      aria-label={`Page ${index + 1}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});

export default function ScoreView({ text, visible, playing, currentBeat }: Props) {
  const [rendered, setRendered] = useState<RenderedScore | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** The compiler's complaint about the current text, if any; the last good render stays up. */
  const [compileError, setCompileError] = useState<string | null>(null);
  /** The engine itself failed to load or render. */
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const scroller = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const lastXml = useRef<string | null>(null);

  // Engrave: off the keystroke path, debounced, and only while on screen.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    // The first render has nothing to protect from jank, so it does not wait.
    const timer = window.setTimeout(
      async () => {
        let compiled;
        try {
          compiled = scoreXml(text);
        } catch (err) {
          if (!cancelled) setCompileError(err instanceof Error ? err.message : String(err));
          return;
        }
        if (!cancelled) {
          setCompileError(null);
          setWarnings(compiled.warnings);
        }
        // An edit that does not change the notation (a comment, say) needs no re-engraving.
        if (compiled.xml === lastXml.current) return;
        setBusy(true);
        try {
          const result = await renderScore(compiled.xml);
          if (cancelled) return;
          lastXml.current = compiled.xml;
          setRendered(result);
          setFailure(null);
        } catch (err) {
          if (!cancelled) setFailure(err instanceof Error ? err.message : String(err));
        } finally {
          if (!cancelled) setBusy(false);
        }
      },
      rendered ? DEBOUNCE_MS : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `rendered` is read only to skip the first debounce; depending on it would re-run after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, visible, attempt]);

  // Notes by id, rebuilt whenever new pages land in the DOM.
  const notes = useRef(new Map<string, Element>());
  useLayoutEffect(() => {
    notes.current = new Map(
      Array.from(pagesRef.current?.querySelectorAll('.vf-stavenote[id]') ?? [], (el) => [
        el.id,
        el,
      ]),
    );
    lit.current = [];
  }, [rendered]);

  // Cursor: colour what sounds now, keep its system on screen.
  const lit = useRef<Element[]>([]);
  useEffect(() => {
    if (!visible) return;
    const ids = playing && rendered ? activeAt(rendered.cursor, currentBeat) : [];
    const next = ids.map((id) => notes.current.get(id)).filter((el): el is Element => !!el);
    // A frame in which nothing changed (most of them) touches no DOM.
    if (next.length === lit.current.length && next.every((el, i) => el === lit.current[i])) return;
    lit.current.forEach((el) => el.classList.remove('playing'));
    next.forEach((el) => el.classList.add('playing'));
    lit.current = next;

    // Scroll only when the first sounding note has left the viewport band; a
    // note inside it is already on screen, so most changes do nothing.
    const note = next[0];
    const box = scroller.current;
    if (!note || !box) return;
    const n = note.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const margin = 48;
    if (n.top < b.top + margin || n.bottom > b.bottom - margin) {
      // Land the system a quarter of the way down, so the next one is in view too.
      box.scrollTo({ top: box.scrollTop + (n.top - b.top) - b.height * 0.25, behavior: 'smooth' });
    }
  }, [currentBeat, playing, rendered, visible]);

  const warningText = useMemo(() => warnings.join('\n'), [warnings]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {((busy && rendered) || compileError || warnings.length > 0) && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-1 text-xs">
          {busy && rendered && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              Updating
            </span>
          )}
          {compileError && (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-destructive" title={compileError}>
              <CircleX className="size-3.5 shrink-0" />
              <span className="truncate">Showing the last score that compiled</span>
            </span>
          )}
          {warnings.length > 0 && (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-warning" title={warningText}>
              <TriangleAlert className="size-3.5 shrink-0" />
              <span className="truncate">
                {warnings[0]}
                {warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}
              </span>
            </span>
          )}
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-background">
        {rendered ? (
          <div ref={pagesRef} className="mx-auto flex w-full max-w-[860px] flex-col gap-5 p-5">
            {rendered.pages.map((svg, i) => (
              <Page key={i} svg={svg} index={i} />
            ))}
          </div>
        ) : failure ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
            <CircleX className="size-6 text-destructive" />
            <p className="max-w-md text-muted-foreground">Could not load the notation engine: {failure}</p>
            <Button
              onClick={() => {
                setFailure(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : compileError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
            <CircleX className="size-6 text-destructive" />
            <p className="max-w-md text-muted-foreground">The score does not compile yet, so there is nothing to show.</p>
            <p className="max-w-md break-words font-mono text-xs text-destructive">{compileError}</p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-6 animate-spin" />
            Loading the notation engine
          </div>
        )}
      </div>
    </div>
  );
}
