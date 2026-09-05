/**
 * Explicit V1 extension boundaries. These are not wired into the Beat Lab UI.
 * Independent time-stretching and Web MIDI need dedicated, testable implementations
 * before they are exposed as controls.
 */

export const BEAT_LAB_EXTENSIONS = {
  independentTimeStretch: false,
  webMidiInput: false,
  automaticVocalConform: false,
  cloudProjectSync: false,
  mp3Export: false,
  advancedStemSeparation: false,
} as const;

export function independentTimeStretchNotAvailable(): never {
  throw new Error("Independent time-stretching is not implemented in Beat Lab V1. Pitch uses resampling and changes duration. Do not expose a fake speed control.");
}
