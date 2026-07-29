/**
 * sampler.ts — the browser's adapter onto core's sampled instruments.
 *
 * The instruments themselves live in core so the server can play the identical
 * recordings; all this adds is HTTP loading and the per-name caching the
 * browser wants (a library is fetched once per session, then reused).
 */

import { loadSampleLibrary, createTrackBus } from '@play.yaml/core';
import type { Sampler, SampleAssets, TrackBus, MelodicSampler, DrumSampler } from '@play.yaml/core';

export { createTrackBus };
export { DRUM_LIBRARY, SAMPLE_LIBRARIES, libraryForTrack, librariesForTracks } from '@play.yaml/core';
export type { Sampler, MelodicSampler, DrumSampler, TrackBus };

/** Fetch the sample files the app serves out of /public/samples. */
const httpAssets: SampleAssets = {
  manifest: async (library) => {
    const response = await fetch(`${import.meta.env.BASE_URL}samples/${library}/manifest.json`);
    if (!response.ok) throw new Error(`${response.status} for ${library}/manifest.json`);
    return await response.json();
  },
  audio: async (library, file) => {
    // Encode the filename: a '#' (sharp pitch) would otherwise become a URL
    // fragment and silently fetch the wrong resource.
    const url = `${import.meta.env.BASE_URL}samples/${library}/${encodeURIComponent(file)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} for ${file}`);
    return await response.arrayBuffer();
  },
};

const loadPromises = new Map<string, Promise<Sampler | null>>();

/**
 * Load a sampled instrument by name (lazily; browser-cached afterwards).
 * Resolves to null when the samples can't be fetched, so callers fall back
 * to the synth presets.
 */
export function loadInstrument(ctx: BaseAudioContext, name: string): Promise<Sampler | null> {
  let promise = loadPromises.get(name);
  if (!promise) {
    promise = loadSampleLibrary(ctx, name, httpAssets).catch((err) => {
      console.warn(`Samples for "${name}" unavailable, falling back to synth:`, err);
      loadPromises.delete(name); // transient failure — retry on the next play
      return null;
    });
    loadPromises.set(name, promise);
  }
  return promise;
}
