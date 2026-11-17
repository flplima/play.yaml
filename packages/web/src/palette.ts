/**
 * Gruvbox, dark medium contrast (morhetz). The one place where the studio's
 * canvases, the piano keys and the editor theme get their colours; the CSS
 * variables in index.css hold the same values for the DOM.
 */
export const GRUVBOX = {
  bg0H: '#1d2021',
  bg0: '#282828',
  bg0S: '#32302f',
  bg1: '#3c3836',
  bg2: '#504945',
  bg3: '#665c54',
  bg4: '#7c6f64',
  fg: '#ebdbb2',
  fg2: '#d5c4a1',
  fg3: '#bdae93',
  fg4: '#a89984',
  gray: '#928374',
  red: '#fb4934',
  green: '#b8bb26',
  yellow: '#fabd2f',
  blue: '#83a598',
  purple: '#d3869b',
  aqua: '#8ec07c',
  orange: '#fe8019',
  // Light variant, used for the cream sheet music paper.
  paper: '#fbf1c7',
} as const;

/** One colour per track, walked in order: a track keeps its colour on every tab. */
export const TRACK_COLORS: readonly string[] = [
  GRUVBOX.blue,
  GRUVBOX.orange,
  GRUVBOX.aqua,
  GRUVBOX.purple,
  GRUVBOX.yellow,
  GRUVBOX.green,
  GRUVBOX.red,
];

export const trackColor = (track: number): string => TRACK_COLORS[track % TRACK_COLORS.length];

/** `#rrggbb` as a canvas colour with an alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Foreground (cream) at an alpha: the canvases' grid lines and labels. */
export const fgAlpha = (alpha: number): string => withAlpha(GRUVBOX.fg, alpha);

/** The chord polygon's colour by chord quality, from the same accents. */
export const QUALITY_COLORS: Record<string, string> = {
  major: GRUVBOX.yellow,
  minor: GRUVBOX.blue,
  dim: GRUVBOX.purple,
  aug: GRUVBOX.green,
  sus: GRUVBOX.aqua,
  other: GRUVBOX.orange,
};
