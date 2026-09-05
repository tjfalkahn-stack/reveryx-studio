"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BeatLabRuntime } from "../engine/runtime";

const BeatLabRuntimeContext = createContext<BeatLabRuntime | null>(null);

export function BeatLabRuntimeProvider({ runtime, children }: { runtime: BeatLabRuntime; children: ReactNode }) {
  return <BeatLabRuntimeContext.Provider value={runtime}>{children}</BeatLabRuntimeContext.Provider>;
}

export function useBeatLabRuntime(): BeatLabRuntime {
  const runtime = useContext(BeatLabRuntimeContext);
  if (!runtime) throw new Error("Beat Lab runtime is not available");
  return runtime;
}
