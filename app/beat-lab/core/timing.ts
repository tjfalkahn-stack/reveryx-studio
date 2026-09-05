export const PPQN = 96;
export const BEATS_PER_BAR = 4;

export type QuantizeGrid = "1/8" | "1/8t" | "1/16" | "1/16t" | "1/32" | "1/32t";
export type PatternBars = 1 | 2 | 4 | 8 | 16;
export type CountInBars = 0 | 1 | 2 | 4;

export const QUANTIZE_TICKS: Record<QuantizeGrid, number> = {
  "1/8": PPQN / 2,
  "1/8t": PPQN / 3,
  "1/16": PPQN / 4,
  "1/16t": PPQN / 6,
  "1/32": PPQN / 8,
  "1/32t": PPQN / 12,
};

export const QUANTIZE_OPTIONS: QuantizeGrid[] = ["1/8", "1/8t", "1/16", "1/16t", "1/32", "1/32t"];
export const PATTERN_BAR_OPTIONS: PatternBars[] = [1, 2, 4, 8, 16];
export const COUNT_IN_OPTIONS: CountInBars[] = [1, 2, 4];

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(300, Math.max(40, Math.round(bpm)));
}

export function secondsPerBeat(bpm: number): number {
  return 60 / clampBpm(bpm);
}

export function secondsPerBar(bpm: number): number {
  return secondsPerBeat(bpm) * BEATS_PER_BAR;
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQN) * secondsPerBeat(bpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return (seconds / secondsPerBeat(bpm)) * PPQN;
}

export function patternLengthTicks(bars: PatternBars | number): number {
  return Math.max(1, bars) * BEATS_PER_BAR * PPQN;
}

export function patternLengthSeconds(bars: PatternBars | number, bpm: number): number {
  return ticksToSeconds(patternLengthTicks(bars), bpm);
}

export function quantizeTicks(ticks: number, grid: QuantizeGrid): number {
  const step = QUANTIZE_TICKS[grid];
  return Math.round(ticks / step) * step;
}

export function isOffbeatSixteenth(ticks: number): boolean {
  const sixteenth = QUANTIZE_TICKS["1/16"];
  const index = Math.floor(Math.round(ticks) / sixteenth);
  return index % 2 === 1;
}

/**
 * Swing delays off-beat 16ths. 0 is straight; 1 delays by 2/3 of a 16th note,
 * which is the triplet 16th-swing feel used by hardware grooveboxes.
 */
export function applySwing(ticks: number, swing: number): number {
  const amount = Math.max(0, Math.min(1, Number.isFinite(swing) ? swing : 0));
  if (amount === 0 || !isOffbeatSixteenth(ticks)) return ticks;
  return ticks + amount * QUANTIZE_TICKS["1/16"] * (2 / 3);
}

export function swungEventSeconds(startTicks: number, bpm: number, swing: number): number {
  return ticksToSeconds(applySwing(startTicks, swing), bpm);
}

export function transportPosition(seconds: number, bpm: number): { bar: number; beat: number; beats: number } {
  const beats = Math.max(0, seconds) / secondsPerBeat(bpm);
  return {
    bar: Math.floor(beats / BEATS_PER_BAR) + 1,
    beat: Math.floor(beats % BEATS_PER_BAR) + 1,
    beats,
  };
}

export function wrapPatternTicks(ticks: number, bars: PatternBars | number): number {
  const length = patternLengthTicks(bars);
  const wrapped = ((ticks % length) + length) % length;
  return wrapped;
}

export function countInSeconds(bars: CountInBars | number, bpm: number): number {
  return Math.max(0, bars) * secondsPerBar(bpm);
}

export function lookAheadWindow(now: number, origin: number, lookahead: number, bpm: number, bars: number, looping: boolean): { fromTicks: number; toTicks: number; wrap: boolean } {
  const fromSeconds = Math.max(0, now - origin);
  const toSeconds = fromSeconds + lookahead;
  const lengthSeconds = patternLengthSeconds(bars, bpm);
  if (!looping) {
    return {
      fromTicks: secondsToTicks(fromSeconds, bpm),
      toTicks: secondsToTicks(toSeconds, bpm),
      wrap: false,
    };
  }
  const fromWrapped = fromSeconds % lengthSeconds;
  const toWrapped = toSeconds % lengthSeconds;
  return {
    fromTicks: secondsToTicks(fromWrapped, bpm),
    toTicks: secondsToTicks(toWrapped, bpm),
    wrap: toWrapped < fromWrapped,
  };
}
