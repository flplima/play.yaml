// Bundle every score from the repo-root examples/ directory as raw text.
const modules = import.meta.glob('../../../examples/*.play.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface Example {
  name: string;
  content: string;
}

export const EXAMPLES: Example[] = Object.entries(modules)
  .map(([path, content]) => ({
    name: path.split('/').pop()!.replace(/\.play\.yaml$/, ''),
    content,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
