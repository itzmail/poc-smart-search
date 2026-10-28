export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Estimate for scenes without audio yet: ~1.8 words/second, measured from the first TTS files (scene0, scene1).
export const WORDS_PER_SECOND = 1.8;
export const secondsFor = (words: number) => Math.max(2, Math.ceil(words / WORDS_PER_SECOND));
