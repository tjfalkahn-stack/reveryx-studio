import { audibleEvents, type Pattern } from "./pattern";
import type { Pad } from "./pads";
import type { BeatLabProject } from "./project-schema";

export const BEAT_LAB_MODES = ["play", "sample", "sequence", "arrange"] as const;
export type BeatLabMode = (typeof BEAT_LAB_MODES)[number];

export const BEAT_LAB_MODE_LABEL: Record<BeatLabMode, string> = {
  play: "Play",
  sample: "Sample",
  sequence: "Sequence",
  arrange: "Arrange",
};

export const EMPTY_PAD_ACTION = "Drop Sound";
export const RECORD_TO_BEAT_DISABLED_REASON = "Record a pattern first";
export const GUIDE_STORAGE_KEY = "reveryx-beat-lab-guide-v1";

export const PAD_VALUE_DEFAULTS = {
  volume: 0.9,
  pan: 0,
  pitchCents: 0,
  attack: 0.002,
  release: 0.04,
} as const;

export type FirstUseGuideProgress = {
  dismissed: boolean;
  choseSound: boolean;
  pressedRecord: boolean;
  playedPads: boolean;
};

export function emptyGuideProgress(): FirstUseGuideProgress {
  return { dismissed: false, choseSound: false, pressedRecord: false, playedPads: false };
}

export function parseGuideProgress(raw: string | null): FirstUseGuideProgress {
  if (!raw) return emptyGuideProgress();
  try {
    const value = JSON.parse(raw) as Partial<FirstUseGuideProgress>;
    if (value.dismissed === true) return { ...emptyGuideProgress(), dismissed: true };
    return {
      dismissed: Boolean(value.dismissed),
      choseSound: Boolean(value.choseSound),
      pressedRecord: Boolean(value.pressedRecord),
      playedPads: Boolean(value.playedPads),
    };
  } catch {
    return emptyGuideProgress();
  }
}

export function isGuideComplete(progress: FirstUseGuideProgress): boolean {
  return progress.choseSound && progress.pressedRecord && progress.playedPads;
}

export function shouldShowFirstUseGuide(progress: FirstUseGuideProgress, untouched: boolean): boolean {
  if (progress.dismissed || isGuideComplete(progress)) return false;
  return untouched || progress.choseSound || progress.pressedRecord || progress.playedPads;
}

export function isUntouchedBeatLabProject(project: BeatLabProject): boolean {
  const hasEvents = project.patterns.some((pattern) => pattern.events.length > 0);
  const hasUserAssets = project.assets.some((asset) => !asset.missing);
  return !hasEvents && !hasUserAssets;
}

export function inspectorPresentation(width: number): "docked" | "overlay" | "sheet" {
  if (width >= 1200) return "docked";
  if (width >= 768) return "overlay";
  return "sheet";
}

export function padHasSound(pad: Pad): boolean {
  return Boolean(pad.assetId || pad.starterKey);
}

export function padDisplayName(pad: Pad): string {
  if (padHasSound(pad)) return pad.name;
  if (/^Pad\s+\d+$/i.test(pad.name.trim()) || !pad.name.trim()) return EMPTY_PAD_ACTION;
  return pad.name;
}

export function patternHasEvents(pattern: Pattern): boolean {
  return pattern.events.length > 0;
}

export function patternIsPlayable(pattern: Pattern): boolean {
  return audibleEvents(pattern).length > 0;
}

export function canRecordToThisBeat(project: BeatLabProject): boolean {
  return project.patterns.some(patternIsPlayable);
}

export function recordToThisBeatDisabledReason(project: BeatLabProject): string | null {
  return canRecordToThisBeat(project) ? null : RECORD_TO_BEAT_DISABLED_REASON;
}

export function patternStripLabel(index: number): string {
  return `P${index + 1}`;
}

export function transportStatus(input: {
  playing: boolean;
  recording: boolean;
  overdub: boolean;
  erase: boolean;
  inCountIn: boolean;
}): string {
  if (input.inCountIn && input.recording) return "Count-in · recording";
  if (input.inCountIn) return "Count-in";
  if (input.playing && input.recording && input.overdub) return "Recording · overdub";
  if (input.playing && input.recording) return "Recording";
  if (input.playing && input.erase) return "Playing · erase armed";
  if (input.playing) return "Playing";
  if (input.recording) return "Armed";
  return "Stopped";
}

export function formatVolume(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatPan(value: number): string {
  const amount = Math.round(value * 100);
  if (amount === 0) return "C";
  return amount < 0 ? `L${Math.abs(amount)}` : `R${amount}`;
}

export function formatCents(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0 ct";
  return `${rounded > 0 ? "+" : ""}${rounded} ct`;
}

export function formatSeconds(value: number): string {
  return `${value.toFixed(3)} s`;
}

export type PadVisualState = {
  empty: boolean;
  selected: boolean;
  pressed: boolean;
  sounding: boolean;
  muted: boolean;
  soloed: boolean;
  choked: boolean;
  hasEvents: boolean;
  missing: boolean;
};

export function padStateClass(state: PadVisualState): string {
  return [
    "bl-pad",
    state.empty ? "empty" : "assigned",
    state.selected ? "selected" : "",
    state.pressed ? "pressed" : "",
    state.sounding ? "sounding" : "",
    state.muted ? "muted" : "",
    state.soloed ? "solo" : "",
    state.choked ? "choked" : "",
    state.hasEvents ? "has-events" : "",
    state.missing ? "missing" : "",
  ].filter(Boolean).join(" ");
}
