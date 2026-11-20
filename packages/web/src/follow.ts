/**
 * follow.ts — following the playback in a scrolling view, and stepping back
 * when the reader takes over.
 *
 * The editor and the score both keep the sounding notes on screen while a
 * song plays. Both stop the moment you scroll yourself: a view that drags you
 * back while you read ahead is worse than one that does not follow at all.
 * Only input counts as taking over (wheel, touch, keys, the scrollbar), never
 * a `scroll` event, which the views' own page turns fire too.
 */

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/**
 * Calls `onManual` when the user scrolls `el` by hand. `anyKey` and
 * `anyPointer` widen it for an editor, where typing or clicking into the text
 * means working there; a read-only view only listens for scrolling keys and
 * a drag on its scrollbar. Returns the cleanup.
 */
export function watchManualScroll(
  el: HTMLElement,
  onManual: () => void,
  opts: { anyKey?: boolean; anyPointer?: boolean } = {},
): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (opts.anyKey ? !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) : NAV_KEYS.has(e.key)) onManual();
  };
  const onPointer = (e: PointerEvent) => {
    // The scrollbar is the part of the element outside its client box.
    const r = el.getBoundingClientRect();
    const onBar = e.target === el && (e.clientX - r.left > el.clientWidth || e.clientY - r.top > el.clientHeight);
    if (opts.anyPointer || onBar) onManual();
  };
  el.addEventListener('wheel', onManual, { passive: true });
  el.addEventListener('touchmove', onManual, { passive: true });
  el.addEventListener('keydown', onKey);
  el.addEventListener('pointerdown', onPointer);
  return () => {
    el.removeEventListener('wheel', onManual);
    el.removeEventListener('touchmove', onManual);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('pointerdown', onPointer);
  };
}

/** Cubic ease in and out, for a page turn that starts and lands softly. */
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
