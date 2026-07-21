/** webaudio-node ships no types — a Web Audio AudioContext for Node. */
declare module 'webaudio-node' {
  export const AudioContext: {
    new (options?: { sampleRate?: number }): BaseAudioContext & {
      close?: () => Promise<void>;
    };
  };
}
