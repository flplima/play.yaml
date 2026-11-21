import { useEffect, useState } from 'react';

/**
 * The phone layout: under 768 px wide, or a phone on its side (short, and
 * driven by touch). A narrow desktop window gets it too, on purpose: the
 * desktop header and side panel don't fit there either.
 */
const PHONE_QUERY = '(max-width: 767px), (max-height: 520px) and (pointer: coarse)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const usePhone = () => useMediaQuery(PHONE_QUERY);

/** iPhone, iPod, or an iPad (which says it is a Mac, but has a touch screen). */
export const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Keeps `--vv-h` and `--vv-top` on the root element in step with the visual
 * viewport, the part of the page you can see right now.
 *
 * iOS Safari lays its keyboard over the page instead of resizing it, then
 * scrolls the page to show the caret. An app sized to the window would put its
 * bottom bar under the keys; sized and placed to the visual viewport, the
 * symbol row sits right on top of them. Pinch zoom also shrinks the visual
 * viewport, so the variables are dropped while zoomed and the app keeps its size.
 */
export function useVisualViewport(enabled: boolean): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    const style = document.documentElement.style;
    const clear = () => {
      style.removeProperty('--vv-h');
      style.removeProperty('--vv-top');
    };
    const update = () => {
      if (Math.abs(vv.scale - 1) > 0.01) return clear();
      style.setProperty('--vv-h', `${vv.height}px`);
      style.setProperty('--vv-top', `${vv.offsetTop}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      clear();
    };
  }, [enabled]);
}
