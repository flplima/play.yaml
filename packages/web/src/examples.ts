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

/** Read the document's `title:` without paying for a full YAML parse. */
function readTitle(content: string): string | undefined {
  const m = /^title:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/m.exec(content);
  const title = m?.[1] ?? m?.[2] ?? m?.[3];
  return title || undefined;
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
