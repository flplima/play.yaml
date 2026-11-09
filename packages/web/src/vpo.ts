/**
 * vpo.ts — the browser's way into the orchestra: the dev server's `/vpo/`
 * route, which serves the library off the machine's own disk. A path segment
 * is encoded on its own: the library names samples like
 * `Trumpet.novib.ff.G#3-PB-loop.wav`, and a raw `#` would end the URL there.
 */
import type { SfzAssets } from '@play.yaml/core';

const url = (path: string) =>
  `${import.meta.env.BASE_URL}vpo/${path.split('/').map(encodeURIComponent).join('/')}`;

export const httpAssets: SfzAssets = {
  text: async (path) => {
    const response = await fetch(url(path));
    if (!response.ok) throw new Error(`${response.status} for ${path}`);
    return await response.text();
  },
  audio: async (path) => {
    const response = await fetch(url(path));
    if (!response.ok) throw new Error(`${response.status} for ${path}`);
    return await response.arrayBuffer();
  },
};
