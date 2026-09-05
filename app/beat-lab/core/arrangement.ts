import { createId } from "./ids";
import { patternLengthSeconds, type PatternBars } from "./timing";
import type { Pattern } from "./pattern";

export type SectionKind = "intro" | "verse" | "hook" | "bridge" | "outro" | "custom";

export type ArrangementSection = {
  id: string;
  kind: SectionKind;
  name: string;
  patternId: string;
  repeats: number;
};

export const SECTION_KINDS: { id: SectionKind; name: string }[] = [
  { id: "intro", name: "Intro" },
  { id: "verse", name: "Verse" },
  { id: "hook", name: "Hook" },
  { id: "bridge", name: "Bridge" },
  { id: "outro", name: "Outro" },
  { id: "custom", name: "Custom" },
];

export function defaultSectionName(kind: SectionKind): string {
  return SECTION_KINDS.find((item) => item.id === kind)?.name || "Section";
}

export function createSection(kind: SectionKind, patternId: string, repeats = 1, name?: string): ArrangementSection {
  return {
    id: createId("sec"),
    kind,
    name: (name || defaultSectionName(kind)).slice(0, 40),
    patternId,
    repeats: Math.min(16, Math.max(1, Math.round(repeats))),
  };
}

export function createDefaultArrangement(patternId: string): ArrangementSection[] {
  return [createSection("verse", patternId, 2)];
}

export type PlacedSection = ArrangementSection & {
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
  startBeats: number;
};

export function placeArrangement(
  sections: ArrangementSection[],
  patterns: Pattern[],
  bpm: number,
): PlacedSection[] {
  let cursor = 0;
  return sections.map((section) => {
    const pattern = patterns.find((item) => item.id === section.patternId);
    const bars: PatternBars = pattern?.bars || 2;
    const durationSeconds = patternLengthSeconds(bars, bpm) * section.repeats;
    const placed: PlacedSection = {
      ...section,
      startSeconds: cursor,
      durationSeconds,
      endSeconds: cursor + durationSeconds,
      startBeats: cursor / (60 / Math.max(40, bpm)) ,
    };
    cursor += durationSeconds;
    return placed;
  });
}

export function arrangementDurationSeconds(sections: ArrangementSection[], patterns: Pattern[], bpm: number): number {
  const placed = placeArrangement(sections, patterns, bpm);
  return placed.at(-1)?.endSeconds || 0;
}

export function moveSection(sections: ArrangementSection[], id: string, direction: -1 | 1): ArrangementSection[] {
  const index = sections.findIndex((section) => section.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= sections.length) return sections;
  const next = sections.slice();
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function duplicateSection(sections: ArrangementSection[], id: string): ArrangementSection[] {
  const index = sections.findIndex((section) => section.id === id);
  if (index < 0) return sections;
  const copy = { ...sections[index], id: createId("sec"), name: `${sections[index].name} copy` };
  const next = sections.slice();
  next.splice(index + 1, 0, copy);
  return next;
}

export function removeSection(sections: ArrangementSection[], id: string): ArrangementSection[] {
  if (sections.length <= 1) return sections;
  return sections.filter((section) => section.id !== id);
}

export function renameSection(sections: ArrangementSection[], id: string, name: string): ArrangementSection[] {
  return sections.map((section) => (section.id === id ? { ...section, name: name.slice(0, 40) || section.name } : section));
}

export function setSectionRepeats(sections: ArrangementSection[], id: string, repeats: number): ArrangementSection[] {
  return sections.map((section) => (section.id === id ? { ...section, repeats: Math.min(16, Math.max(1, Math.round(repeats))) } : section));
}

export function insertSection(
  sections: ArrangementSection[],
  afterId: string | null,
  kind: SectionKind,
  patternId: string,
): ArrangementSection[] {
  const section = createSection(kind, patternId, 1);
  if (!afterId) return [...sections, section];
  const index = sections.findIndex((item) => item.id === afterId);
  const next = sections.slice();
  next.splice(index < 0 ? next.length : index + 1, 0, section);
  return next;
}

export type SectionMarker = {
  id: string;
  name: string;
  kind: SectionKind;
  startSeconds: number;
  endSeconds: number;
};

export function sectionMarkersForHandoff(placed: PlacedSection[]): SectionMarker[] {
  return placed.map((section) => ({
    id: section.id,
    name: section.name,
    kind: section.kind,
    startSeconds: section.startSeconds,
    endSeconds: section.endSeconds,
  }));
}
