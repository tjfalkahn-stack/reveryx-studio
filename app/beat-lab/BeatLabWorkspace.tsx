"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useStudioSession } from "../session/studio-session";
import { BeatLabRuntime } from "./engine/runtime";
import { ArrangementView } from "./components/ArrangementView";
import { ExportPanel } from "./components/ExportPanel";
import { PadEditor } from "./components/PadEditor";
import { PadGrid } from "./components/PadGrid";
import { PatternEditor } from "./components/PatternEditor";
import { SampleLab } from "./components/SampleLab";
import { TransportBar } from "./components/TransportBar";
import { BeatLabRuntimeProvider, useBeatLabRuntime } from "./components/runtime-context";

let sharedRuntime: BeatLabRuntime | null = null;

function getBeatLabRuntime() {
  if (!sharedRuntime) sharedRuntime = new BeatLabRuntime();
  return sharedRuntime;
}

export default function BeatLabWorkspace({ announce, openRecorder }: { announce: (message: string) => void; openRecorder: () => void }) {
  const [runtime] = useState(getBeatLabRuntime);
  const session = useStudioSession();

  useEffect(() => {
    void runtime.restore();
    return () => {
      runtime.stop();
      void runtime.save();
    };
  }, [runtime]);

  async function recordToThisBeat() {
    try {
      await runtime.ensureContext();
      const payload = await runtime.recordToThisBeat();
      session.applyBeatHandoff(payload);
      announce("Beat rendered and handed to the vocal recorder. Beat Lab source is still editable.");
      openRecorder();
    } catch {
      announce("Could not render this beat. The project is still saved locally.");
    }
  }

  return <BeatLabRuntimeProvider runtime={runtime}>
    <BeatLabShell announce={announce} onRecordToBeat={() => void recordToThisBeat()} />
  </BeatLabRuntimeProvider>;
}

function BeatLabShell({ announce, onRecordToBeat }: { announce: (message: string) => void; onRecordToBeat: () => void }) {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  const session = useStudioSession();
  const warning = runtime.missingWarning || runtime.state.warnings[0]?.message || "";
  const vocalLock = session.hasVocals && session.lockedBeatRevision != null && session.lockedBeatRevision !== project.beatRevision;

  return <div className="beat-lab">
    <header className="bl-topbar">
      <div>
        <small>REVERYX / BEAT LAB</small>
        <input className="bl-title" value={project.title} onChange={(event) => runtime.state.setTitle(event.target.value)} aria-label="Beat title" />
      </div>
      <p>Play the starter kit immediately, flip a sample, record a pattern, then hand the arrangement to the vocal recorder.</p>
    </header>
    {warning && <div className="bl-banner" role="status">{warning}</div>}
    {vocalLock && <div className="bl-banner lock" role="status">Vocals were recorded against an earlier beat revision. Recorded timing is preserved. Beat Lab will not silently shift those takes.</div>}
    <TransportBar onRecordToBeat={onRecordToBeat} />
    <div className="bl-layout">
      <PadGrid />
      <div className="bl-side">
        <PadEditor />
        <SampleLab />
      </div>
    </div>
    <PatternEditor />
    <ArrangementView />
    <ExportPanel announce={announce} />
  </div>;
}
