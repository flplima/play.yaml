/**
 * vpo.ts — the browser's way into the orchestra.
 *
 * The instruments live in core (vpo.ts, sfzSampler.ts) so the server renders
 * the identical recordings; all this adds is where the files come from — the
 * dev server's `/vpo/` route, which serves the library off the machine's own
 * disk. A path segment is encoded on its own: the library names samples like
 * `Trumpet.novib.ff.G#3-PB-loop.wav`, and a raw `#` would end the URL there.
 */
import { prepareVpo, type CompiledSong, type ScheduleInstrument, type SfzAssets } from '@play.yaml/core';

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

/**
 * The orchestra for a song, samples fetched for the notes it plays, by track
 * name. Programs and decoded samples are cached in core across calls, so a
 * second play — or a hot-swap that adds a bar — downloads only what is new.
 */
export function loadOrchestra(
  ctx: BaseAudioContext,
  song: CompiledSong,
  opts: { onlyTracks?: string[] } = {},
): Promise<Map<string, ScheduleInstrument>> {
  return prepareVpo(ctx, httpAssets, song, opts);
}
