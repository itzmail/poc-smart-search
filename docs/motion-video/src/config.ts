export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Placeholder timing until the voiceover exists: ~3 words/second (matches the per-scene estimates in NARASI.md).
export const WORDS_PER_SECOND = 3;
export const secondsFor = (words: number) => Math.max(2, Math.ceil(words / WORDS_PER_SECOND));
