"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { BeatToRecorderHandoff } from "./load-song";
import type { HandoffTrack } from "./load-song";

export type SessionSectionMarker = {
  id: string;
  name: string;
  kind: string;
  startSeconds: number;
  endSeconds: number;
};

export type SessionBeat = {
  song: string;
  source: string;
  beatUrl: string;
  importedTracks: HandoffTrack[];
  bpm: number;
  bpmDetected: boolean;
  sectionMarkers: SessionSectionMarker[];
  beatRevision: number;
  beatSource: "file" | "beat-lab" | "";
};

export const EMPTY_SESSION_BEAT: SessionBeat = {
  song: "Untitled Session",
  source: "Stems",
  beatUrl: "",
  importedTracks: [],
  bpm: 128,
  bpmDetected: false,
  sectionMarkers: [],
  beatRevision: 0,
  beatSource: "",
};

type StudioSessionValue = {
  sessionBeat: SessionBeat;
  setSessionBeat: (beat: SessionBeat | ((current: SessionBeat) => SessionBeat)) => void;
  applyBeatHandoff: (payload: BeatToRecorderHandoff) => void;
  hasVocals: boolean;
  setHasVocals: (value: boolean) => void;
  lockedBeatRevision: number | null;
  lockVocalsToRevision: (revision: number | null) => void;
};

const StudioSessionContext = createContext<StudioSessionValue | null>(null);

export function StudioSessionProvider({ children }: { children: ReactNode }) {
  const [sessionBeat, setSessionBeat] = useState<SessionBeat>(EMPTY_SESSION_BEAT);
  const [hasVocals, setHasVocals] = useState(false);
  const [lockedBeatRevision, setLockedBeatRevision] = useState<number | null>(null);
  const value = useMemo<StudioSessionValue>(() => ({
    sessionBeat,
    setSessionBeat,
    applyBeatHandoff: (payload) => {
      setSessionBeat((current) => {
        const vocals = current.importedTracks.filter((track) => track.role === "VOCAL");
        return {
          song: payload.title,
          source: "Beat Lab",
          beatUrl: payload.beatUrl,
          importedTracks: [{
            id: Date.now(),
            name: `${payload.title}.wav`,
            url: payload.beatUrl,
            duration: payload.duration,
            peaks: payload.peaks,
            role: "BEAT",
            format: "WAV",
          }, ...vocals],
          bpm: payload.bpm,
          bpmDetected: true,
          sectionMarkers: payload.sectionMarkers,
          beatRevision: payload.beatRevision,
          beatSource: "beat-lab",
        };
      });
    },
    hasVocals,
    setHasVocals,
    lockedBeatRevision,
    lockVocalsToRevision: setLockedBeatRevision,
  }), [sessionBeat, hasVocals, lockedBeatRevision]);
  return <StudioSessionContext.Provider value={value}>{children}</StudioSessionContext.Provider>;
}

export function useStudioSession(): StudioSessionValue {
  const value = useContext(StudioSessionContext);
  if (!value) {
    throw new Error("useStudioSession must be used inside StudioSessionProvider");
  }
  return value;
}
