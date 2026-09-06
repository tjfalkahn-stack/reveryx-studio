export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as Partial<HTMLElement> & { closest?: (selector: string) => Element | null };
  const tag = String(node.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (node.isContentEditable) return true;
  if (typeof node.getAttribute === "function") {
    const role = node.getAttribute("role");
    if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
  }
  if (typeof node.closest === "function") {
    if (node.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return true;
    const dialog = node.closest("[role='dialog'], [role='alertdialog'], [data-bl-editor]");
    if (dialog) return true;
  }
  return false;
}

export const PAD_KEY_MAP = ["1", "2", "3", "4", "q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"] as const;
export const PAD_KEY_LABELS = ["1", "2", "3", "4", "Q", "W", "E", "R", "A", "S", "D", "F", "Z", "X", "C", "V"] as const;

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

export function padKeyLabel(index: number): string {
  return PAD_KEY_LABELS[index] || "";
}

export function shouldIgnorePadAutoRepeat(repeat: boolean, noteRepeatEnabled: boolean): boolean {
  return Boolean(repeat) && !noteRepeatEnabled;
}

export function resolvePadKeyDown(
  event: { key: string; repeat: boolean; target: EventTarget | null },
  noteRepeatEnabled: boolean,
): PadInputEvent | null {
  if (isTypingTarget(event.target)) return null;
  if (shouldIgnorePadAutoRepeat(event.repeat, noteRepeatEnabled)) return null;
  const padIndex = keyToPadIndex(event.key);
  if (padIndex == null) return null;
  return { type: "pad-on", padIndex, velocity: 1, source: "keyboard" };
}

export function resolvePadKeyUp(event: { key: string }): PadInputEvent | null {
  const padIndex = keyToPadIndex(event.key);
  if (padIndex == null) return null;
  return { type: "pad-off", padIndex, velocity: 1, source: "keyboard" };
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
