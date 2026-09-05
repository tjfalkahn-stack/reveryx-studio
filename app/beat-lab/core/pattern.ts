import { createId } from "./ids";
import { patternLengthTicks, quantizeTicks, type PatternBars, type QuantizeGrid } from "./timing";

export type NoteEvent = {
  id: string;
  padId: string;
  startTicks: number;
  durationTicks: number;
  velocity: number;
};

export type Pattern = {
  id: string;
  name: string;
  bars: PatternBars;
  events: NoteEvent[];
  mutedPadIds: string[];
};

export function createPattern(name: string, bars: PatternBars = 2): Pattern {
  return {
    id: createId("pat"),
    name,
    bars,
    events: [],
    mutedPadIds: [],
  };
}

export function createDefaultPatterns(count = 8): Pattern[] {
  return Array.from({ length: Math.max(8, count) }, (_, index) => createPattern(`Pattern ${index + 1}`, 2));
}

export function clampVelocity(velocity: number): number {
  if (!Number.isFinite(velocity)) return 100;
  return Math.min(127, Math.max(1, Math.round(velocity)));
}

export function createNote(padId: string, startTicks: number, durationTicks = 24, velocity = 100): NoteEvent {
  return {
    id: createId("nt"),
    padId,
    startTicks: Math.max(0, startTicks),
    durationTicks: Math.max(1, durationTicks),
    velocity: clampVelocity(velocity),
  };
}

export function audibleEvents(pattern: Pattern): NoteEvent[] {
  const length = patternLengthTicks(pattern.bars);
  const muted = new Set(pattern.mutedPadIds);
  return pattern.events.filter((event) => event.startTicks >= 0 && event.startTicks < length && !muted.has(event.padId));
}

export function setPatternBars(pattern: Pattern, bars: PatternBars): Pattern {
  return { ...pattern, bars };
}

export function eventsBeyondLength(pattern: Pattern): NoteEvent[] {
  const length = patternLengthTicks(pattern.bars);
  return pattern.events.filter((event) => event.startTicks >= length);
}

export function addOrReplaceStep(pattern: Pattern, padId: string, startTicks: number, grid: QuantizeGrid, velocity = 100): Pattern {
  const quantized = Math.max(0, quantizeTicks(startTicks, grid));
  const existing = pattern.events.find((event) => event.padId === padId && event.startTicks === quantized);
  if (existing) {
    return { ...pattern, events: pattern.events.filter((event) => event.id !== existing.id) };
  }
  return {
    ...pattern,
    events: [...pattern.events, createNote(padId, quantized, Math.max(1, Math.round((96 / 4))), velocity)],
  };
}

export function updateEvent(pattern: Pattern, eventId: string, patch: Partial<NoteEvent>): Pattern {
  return {
    ...pattern,
    events: pattern.events.map((event) => (event.id === eventId ? { ...event, ...patch, id: event.id } : event)),
  };
}

export function removeEvent(pattern: Pattern, eventId: string): Pattern {
  return { ...pattern, events: pattern.events.filter((event) => event.id !== eventId) };
}

export function erasePadEvents(pattern: Pattern, padId: string): Pattern {
  return { ...pattern, events: pattern.events.filter((event) => event.padId !== padId) };
}

export function eraseWindow(pattern: Pattern, padId: string, fromTicks: number, toTicks: number): Pattern {
  return {
    ...pattern,
    events: pattern.events.filter((event) => {
      if (event.padId !== padId) return true;
      return event.startTicks < fromTicks || event.startTicks >= toTicks;
    }),
  };
}

export function duplicatePattern(pattern: Pattern, name?: string): Pattern {
  return {
    ...pattern,
    id: createId("pat"),
    name: name || `${pattern.name} copy`,
    events: pattern.events.map((event) => ({ ...event, id: createId("nt") })),
    mutedPadIds: [...pattern.mutedPadIds],
  };
}

export function clearPattern(pattern: Pattern): Pattern {
  return { ...pattern, events: [] };
}

export function renamePattern(pattern: Pattern, name: string): Pattern {
  return { ...pattern, name: name.slice(0, 40) || pattern.name };
}

export function togglePadMute(pattern: Pattern, padId: string): Pattern {
  const muted = pattern.mutedPadIds.includes(padId)
    ? pattern.mutedPadIds.filter((id) => id !== padId)
    : [...pattern.mutedPadIds, padId];
  return { ...pattern, mutedPadIds: muted };
}

export function quantizePattern(pattern: Pattern, grid: QuantizeGrid): Pattern {
  return {
    ...pattern,
    events: pattern.events.map((event) => ({
      ...event,
      startTicks: Math.max(0, quantizeTicks(event.startTicks, grid)),
    })),
  };
}

export function recordLiveNote(pattern: Pattern, padId: string, musicalTicks: number, quantize: QuantizeGrid | "off", velocity: number, durationTicks = 24): Pattern {
  const startTicks = quantize === "off" ? Math.max(0, musicalTicks) : Math.max(0, quantizeTicks(musicalTicks, quantize));
  return { ...pattern, events: [...pattern.events, createNote(padId, startTicks, durationTicks, velocity)] };
}
