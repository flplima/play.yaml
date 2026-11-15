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
  /** The score's `title:`, when it has one: what the picker searches on. */
  title?: string;
}

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
