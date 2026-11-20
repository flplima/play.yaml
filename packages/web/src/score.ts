/**
 * score.ts: the score as engraved sheet music, through OpenSheetMusicDisplay.
 *
 * Core writes MusicXML; OSMD (which draws with VexFlow) turns it into A4 SVG
 * pages. It steps a cursor through the piece rather than answering "what
 * sounds at this beat", so after each render the cursor is walked once and
 * its stops are kept as a sorted list of beats, which is what makes the
 * per-frame lookup a binary search. OSMD is 1.4 MB of JS, so it is only ever
 * pulled in with `import()`: a visit that never opens the Score tab or
 * presses PDF downloads none of it.
 */
import { parseYaml, scoreFromDoc, encodeMusicXml } from '@play.yaml/core';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/** The width OSMD lays an A4 page out at, in CSS pixels. The page's height follows from the A4 ratio. */
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = Math.round((PAGE_WIDTH * 297) / 210);

export interface ScoreXml {
  xml: string;
  /** What core could not write exactly (voices squeezed, rhythms approximated). */
  warnings: string[];
}

export interface RenderedScore {
  /** One SVG string per A4 page. */
  pages: string[];
  /** What is sounding at each step of the cursor, for the highlight. */
  cursor: CursorIndex;
}

/** Compile play.yaml text to MusicXML. Throws the compiler's own message on bad input. */
export function scoreXml(text: string): ScoreXml {
  const score = scoreFromDoc(parseYaml(text));
  return { xml: encodeMusicXml(score), warnings: score.warnings };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

type Osmd = typeof import('opensheetmusicdisplay');
let engine: Promise<Osmd> | null = null;

/** The library, loaded once. */
export function loadOsmd(): Promise<Osmd> {
  engine ??= import('opensheetmusicdisplay');
  // A failed load (offline, blocked) must be retryable, not cached forever.
  engine.catch(() => (engine = null));
  return engine;
}

/** OSMD is stateful (load replaces the score and render the pages), so calls take turns. */
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

/** Hand the event loop back so a pending paint or keystroke goes first. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Printed-edition density. OSMD's defaults leave a lot of air around staves
 * and systems; these bring a page close to what an engraver would fit.
 * Units are OSMD's: one unit is the distance between two staff lines.
 */
function tighten(osmd: OpenSheetMusicDisplay): void {
  const rules = osmd.EngravingRules;
  rules.PageLeftMargin = 4;
  rules.PageRightMargin = 4;
  rules.PageTopMargin = 3;
  rules.PageTopMarginNarrow = 2;
  rules.PageBottomMargin = 3;
  rules.SystemLeftMargin = 1;
  rules.TitleTopDistance = 2;
  rules.SheetTitleHeight = 3;
  rules.MinimumDistanceBetweenSystems = 3;
  rules.MinSkyBottomDistBetweenSystems = 3;
  rules.StaffDistance = 4;
  rules.BetweenStaffDistance = 3;
  rules.MinSkyBottomDistBetweenStaves = 1.5;
  rules.MinNoteDistance = 1.5;
}

/**
 * OSMD draws a staff about 10.6 mm tall on A4, large for a full score.
 * 0.75 makes it 8 mm, which is what printed editions use, and fits roughly
 * twice as many bars on a page.
 */
const ZOOM = 0.75;

/** MusicXML to SVG pages plus the cursor index. */
export function renderScore(xml: string): Promise<RenderedScore> {
  return exclusive(async () => {
    const { OpenSheetMusicDisplay } = await loadOsmd();
    await yieldToUi();
    // OSMD measures its container to scale the page, so it has to be in the
    // document. It sits off screen and is gone before this returns.
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_WIDTH}px;`;
    document.body.appendChild(host);
    try {
      const osmd = new OpenSheetMusicDisplay(host, {
        backend: 'svg',
        autoResize: false,
        // MusicXML already carries the beams.
        autoBeam: false,
        drawTitle: true,
        // Top right, under the title, as engraved editions print it.
        drawComposer: true,
        drawPartNames: true,
        drawingParameters: 'compacttight',
        pageFormat: 'A4_P',
        pageBackgroundColor: '#FFFFFF',
        followCursor: false,
      });
      await osmd.load(xml);
      tighten(osmd);
      osmd.zoom = ZOOM;
      osmd.render();
      const pages = Array.from(host.querySelectorAll('svg'), pageMarkup);
      if (pages.length === 0) throw new Error('OSMD drew no pages');
      return { pages, cursor: buildCursorIndex(osmd) };
    } finally {
      host.remove();
    }
  });
}

/** An OSMD page as markup that scales with its card: it only has a pixel size. */
function pageMarkup(svg: SVGSVGElement): string {
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width') ?? '') || PAGE_WIDTH;
    const h = parseFloat(svg.getAttribute('height') ?? '') || PAGE_HEIGHT;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  return svg.outerHTML;
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

/**
 * The element ids sounding at each stop of the cursor, built once per render
 * so that a lookup per animation frame is a binary search and no OSMD call.
 * A note stays in the list for as long as it lasts, not just at the stop it
 * starts on: a whole note under running 16ths stays lit for the whole bar.
 */
export interface CursorIndex {
  /** Quarter beats of each stop, ascending. */
  beats: number[];
  /** SVG element ids of the notes at each stop. */
  ids: string[][];
}

function buildCursorIndex(osmd: OpenSheetMusicDisplay): CursorIndex {
  const beats: number[] = [];
  const ids: string[][] = [];
  const cursor = osmd.cursor;
  // The iterator is walked directly: cursor.next() would also move an HTML
  // overlay at every one of thousands of steps.
  cursor.reset();
  const it = cursor.Iterator;
  let ringing: { id: string; end: number }[] = [];
  while (!it.EndReached) {
    const at = it.currentTimeStamp.RealValue * 4;
    ringing = ringing.filter((r) => r.end > at + 1e-6);
    // The cursor lists the notes that start here; a chord is one element.
    for (const g of cursor.GNotesUnderCursor()) {
      if (g.sourceNote.isRest()) continue;
      const id = (g as unknown as { getSVGGElement?: () => SVGGElement | undefined }).getSVGGElement?.()?.id;
      if (!id || ringing.some((r) => r.id === id)) continue;
      ringing.push({ id, end: at + g.sourceNote.Length.RealValue * 4 });
    }
    beats.push(at);
    ids.push(ringing.map((r) => r.id));
    it.moveToNext();
  }
  cursor.reset();
  return { beats, ids };
}

const NONE: string[] = [];

/** Ids sounding at a beat (quarter notes from the start). The returned array is shared, do not mutate. */
export function activeAt(index: CursorIndex, beat: number): string[] {
  const { beats } = index;
  let lo = 0;
  let hi = beats.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= beat) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? NONE : index.ids[found];
}
