export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Placeholder timing until the voiceover exists: ~2.5 words/second.
export const WORDS_PER_SECOND = 2.5;
export const secondsFor = (words: number) => Math.max(2, Math.ceil(words / WORDS_PER_SECOND));
