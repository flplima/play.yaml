import { parseYaml } from '@play.yaml/core';

// Bundle every score from the repo-root examples/ directory — and every song
// project under songs/<slug>/ (see docs/song-workflow.md) — as raw text.
const exampleModules = import.meta.glob('../../../examples/*.play.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const songModules = import.meta.glob('../../../songs/*/*.play.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface Example {
  name: string;
  content: string;
  /** Which directory it came from — the picker groups by this. */
  group: 'example' | 'song';
  /** The score's `title:`, when it has one: what the picker shows and searches on. */
  title?: string;
  /** Who wrote it, as the score's header spells it. Empty for an unlisted score. */
  composer?: string;
  /** The picker's group heading. Absent when the score is not listed. */
  category?: Category;
}

export const CATEGORIES = ['Baroque', 'Classical', 'Romantic', 'Impressionist', 'Brazilian'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * What the picker lists. Keyed by file name (the scores' own headers stay as
 * they are). A score with no entry here is still bundled, and still loads by
 * name (a stored last-song, the tests), but is not offered: the demos and
 * labs, and the second copy of a piece that appears twice:
 *   - examples/bwv881 is the prelude alone; songs/bwv-881-prelude-and-fugue-12 has both.
 *   - songs/debussy-clair-de-lune carries 146 fewer notes than examples/clair-de-lune.
 */
const LISTED: Record<string, { composer: string; category: Category }> = {
  'ave-maria-bach-gounod': { composer: 'Bach / Gounod', category: 'Romantic' },
  'bwv846': { composer: 'J.S. Bach', category: 'Baroque' },
  'bwv1007': { composer: 'J.S. Bach', category: 'Baroque' },
  'bwv-106-sonatina': { composer: 'J.S. Bach', category: 'Baroque' },
  'bwv-106-gottes-zeit': { composer: 'J.S. Bach', category: 'Baroque' },
  'bwv-106-in-deine-haende': { composer: 'J.S. Bach', category: 'Baroque' },
  'bwv-528-andante': { composer: 'J.S. Bach', category: 'Baroque' },
  'bwv-784-invention-13': { composer: 'J.S. Bach', category: 'Baroque' },
  'bwv-881-prelude-and-fugue-12': { composer: 'J.S. Bach', category: 'Baroque' },
  'fur-elise': { composer: 'Ludwig van Beethoven', category: 'Classical' },
  'nocturne-op9-no2': { composer: 'Frédéric Chopin', category: 'Romantic' },
  'clair-de-lune': { composer: 'Claude Debussy', category: 'Impressionist' },
  'tico-tico-no-fuba': { composer: 'Zequinha de Abreu', category: 'Brazilian' },
};

function readTitle(content: string): string | undefined {
  try {
    const title = parseYaml(content)?.title;
    return typeof title === 'string' && title ? title : undefined;
  } catch {
    return undefined;
  }
}

function toExamples(modules: Record<string, string>, group: Example['group']): Example[] {
  return Object.entries(modules).map(([path, content]) => ({
    name: path.split('/').pop()!.replace(/\.play\.yaml$/, ''),
    content,
    group,
    title: readTitle(content),
    ...LISTED[path.split('/').pop()!.replace(/\.play\.yaml$/, '')],
  }));
}

export const EXAMPLES: Example[] = [
  ...toExamples(exampleModules, 'example'),
  ...toExamples(songModules, 'song'),
].sort((a, b) => a.name.localeCompare(b.name));

/**
 * The score a first visit opens on. The Ave Maria plays on the synth presets
 * alone, so it sounds the same on a static host with no sample library.
 */
export const DEFAULT_EXAMPLE: Example | undefined =
  EXAMPLES.find((e) => e.name === 'ave-maria-bach-gounod') ?? EXAMPLES[0];

/** What the picker offers, in category order, then by title. */
export const LISTED_EXAMPLES: Example[] = EXAMPLES.filter((e) => e.category).sort(
  (a, b) =>
    CATEGORIES.indexOf(a.category!) - CATEGORIES.indexOf(b.category!) ||
    (a.title ?? a.name).localeCompare(b.title ?? b.name),
);
