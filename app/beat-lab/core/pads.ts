import { createId, padId } from "./ids";

export type BankId = "A" | "B" | "C" | "D";
export type StemBus = "drums" | "sample" | "bass" | "instrument";
export type PadPlayMode = "one-shot" | "gate";

export const BANKS: BankId[] = ["A", "B", "C", "D"];
export const PADS_PER_BANK = 16;

export type Pad = {
  id: string;
  bank: BankId;
  index: number;
  name: string;
  color: string;
  assetId: string | null;
  starterKey: string | null;
  volume: number;
  pan: number;
  pitchCents: number;
  start: number;
  end: number;
  attack: number;
  release: number;
  fadeIn: number;
  fadeOut: number;
  normalizeGain: number;
  playMode: PadPlayMode;
  reverse: boolean;
  mute: boolean;
  solo: boolean;
  chokeGroup: number | null;
  stemBus: StemBus;
};

export const PAD_COLORS = ["#43e7ff", "#ff5f6d", "#d9ff48", "#a47dff", "#ffc36b", "#f080bb", "#75a9ff", "#62e6b0"];

export function defaultPad(bank: BankId, index: number, partial: Partial<Pad> = {}): Pad {
  return {
    id: padId(bank, index),
    bank,
    index,
    name: `Pad ${index + 1}`,
    color: PAD_COLORS[index % PAD_COLORS.length],
    assetId: null,
    starterKey: null,
    volume: 0.9,
    pan: 0,
    pitchCents: 0,
    start: 0,
    end: 1,
    attack: 0.002,
    release: 0.04,
    fadeIn: 0,
    fadeOut: 0,
    normalizeGain: 1,
    playMode: "one-shot",
    reverse: false,
    mute: false,
    solo: false,
    chokeGroup: null,
    stemBus: "drums",
    ...partial,
  };
}

export function createPadBank(bank: BankId): Pad[] {
  return Array.from({ length: PADS_PER_BANK }, (_, index) => defaultPad(bank, index));
}

export function createAllPads(): Pad[] {
  return BANKS.flatMap((bank) => createPadBank(bank));
}

export function padsInBank(pads: Pad[], bank: BankId): Pad[] {
  return pads.filter((pad) => pad.bank === bank).sort((a, b) => a.index - b.index);
}

export function findPad(pads: Pad[], id: string): Pad | undefined {
  return pads.find((pad) => pad.id === id);
}

export function replacePad(pads: Pad[], id: string, patch: Partial<Pad>): Pad[] {
  return pads.map((pad) => (pad.id === id ? { ...pad, ...patch, id: pad.id, bank: pad.bank, index: pad.index } : pad));
}

export function duplicatePad(pads: Pad[], sourceId: string, targetId: string): Pad[] {
  const source = findPad(pads, sourceId);
  const target = findPad(pads, targetId);
  if (!source || !target) return pads;
  const copy: Pad = {
    ...source,
    id: target.id,
    bank: target.bank,
    index: target.index,
    name: `${source.name} copy`,
  };
  return pads.map((pad) => (pad.id === targetId ? copy : pad));
}

export function clearPad(pads: Pad[], id: string): Pad[] {
  const current = findPad(pads, id);
  if (!current) return pads;
  return replacePad(pads, id, {
    ...defaultPad(current.bank, current.index, { id: current.id }),
  });
}

export function padIsAudible(pad: Pad, pads: Pad[]): boolean {
  if (pad.mute) return false;
  const soloed = pads.some((item) => item.solo);
  if (soloed && !pad.solo) return false;
  return Boolean(pad.assetId || pad.starterKey);
}

export function consecutivePads(pads: Pad[], startId: string, count: number): Pad[] {
  const start = findPad(pads, startId);
  if (!start) return [];
  const bankPads = padsInBank(pads, start.bank);
  return bankPads.slice(start.index, start.index + count);
}

export function assignSliceRegions(
  pads: Pad[],
  startPadId: string,
  assetId: string,
  regions: { start: number; end: number }[],
  namePrefix: string,
): Pad[] {
  const targets = consecutivePads(pads, startPadId, regions.length);
  let next = pads;
  targets.forEach((pad, index) => {
    const region = regions[index];
    next = replacePad(next, pad.id, {
      assetId,
      starterKey: null,
      name: `${namePrefix} ${index + 1}`,
      start: region.start,
      end: region.end,
      reverse: false,
      stemBus: "sample",
    });
  });
  return next;
}

export function newEmptyPadName(): string {
  return `Pad ${createId("p").slice(-4)}`;
}
