export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export const PAD_KEY_MAP = ["1", "2", "3", "4", "q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"] as const;

export type PadInputSource = "pointer" | "keyboard" | "midi";

export type PadInputEvent = {
  type: "pad-on" | "pad-off";
  padIndex: number;
  velocity: number;
  source: PadInputSource;
};

export function keyToPadIndex(key: string): number | null {
  const index = PAD_KEY_MAP.indexOf(key.toLowerCase() as typeof PAD_KEY_MAP[number]);
  return index >= 0 ? index : null;
}

export function bankFromKey(key: string): "A" | "B" | "C" | "D" | null {
  const upper = key.toUpperCase();
  if (upper === "A" || upper === "B" || upper === "C" || upper === "D") return upper;
  return null;
}

/**
 * MIDI is intentionally not opened in V1. Keep this shape so a later input
 * source can emit the same PadInputEvent stream after it is implemented and tested.
 */
export type MidiPortDescriptor = { id: string; name: string; connected: boolean };
