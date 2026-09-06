"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStudioSession } from "../session/studio-session";
import { BeatLabRuntime } from "./engine/runtime";
import { ArrangementView } from "./components/ArrangementView";
import { ExportPanel } from "./components/ExportPanel";
import { FirstUseGuide } from "./components/FirstUseGuide";
import { ModeSwitcher } from "./components/ModeSwitcher";
import { PadEditor } from "./components/PadEditor";
import { PadGrid } from "./components/PadGrid";
import { PadInspector } from "./components/PadInspector";
import { PadKeyboard } from "./components/PadKeyboard";
import { PatternEditor } from "./components/PatternEditor";
import { PatternStrip } from "./components/PatternStrip";
import { SampleLab } from "./components/SampleLab";
import { TransportBar } from "./components/TransportBar";
import { BeatLabRuntimeProvider, useBeatLabRuntime } from "./components/runtime-context";
import {
  GUIDE_STORAGE_KEY,
  isGuideComplete,
  isUntouchedBeatLabProject,
  parseGuideProgress,
  shouldShowFirstUseGuide,
  type BeatLabMode,
  type FirstUseGuideProgress,
} from "./core/ux";
import { selectedPad, selectedPattern } from "./core/project-schema";

let sharedRuntime: BeatLabRuntime | null = null;

function getBeatLabRuntime() {
  if (!sharedRuntime) sharedRuntime = new BeatLabRuntime();
  return sharedRuntime;
}

const guideListeners = new Set<() => void>();

function subscribeGuide(listener: () => void) {
  guideListeners.add(listener);
  return () => { guideListeners.delete(listener); };
}

function getGuideSnapshot() {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(GUIDE_STORAGE_KEY) || "";
}

function writeGuide(progress: FirstUseGuideProgress) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(progress));
}

function persistGuide(progress: FirstUseGuideProgress) {
  writeGuide(progress);
  for (const listener of guideListeners) listener();
}

function subscribeDesktop(listener: () => void) {
  const media = window.matchMedia("(min-width: 1200px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getDesktopSnapshot() {
  return window.matchMedia("(min-width: 1200px)").matches;
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
  useSyncExternalStore(runtime.subscribeUi, runtime.getUiSnapshot, runtime.getUiSnapshot);
  const session = useStudioSession();
  const warning = runtime.missingWarning || runtime.state.warnings[0]?.message || "";
  const vocalLock = session.hasVocals && session.lockedBeatRevision != null && session.lockedBeatRevision !== project.beatRevision;
  const [mode, setMode] = useState<BeatLabMode>("play");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, () => true);
  const guideRaw = useSyncExternalStore(subscribeGuide, getGuideSnapshot, () => "");
  const guide = parseGuideProgress(guideRaw || null);
  const padRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const restoreFocusId = useRef<string | null>(null);
  const pad = selectedPad(project);
  const pattern = selectedPattern(project);
  const modalInspector = !isDesktop;

  const updateGuide = useCallback((patch: Partial<FirstUseGuideProgress>) => {
    const current = parseGuideProgress(getGuideSnapshot() || null);
    if (current.dismissed) return;
    const next = { ...current, ...patch };
    if (isGuideComplete(next)) next.dismissed = true;
    persistGuide(next);
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    const id = restoreFocusId.current || pad.id;
    window.requestAnimationFrame(() => padRefs.current.get(id)?.focus());
  }, [pad.id]);

  const openInspector = useCallback((padId: string) => {
    restoreFocusId.current = padId;
    setInspectorOpen(true);
  }, []);

  const showGuide = shouldShowFirstUseGuide(guide, isUntouchedBeatLabProject(project));

  return <div className={`beat-lab mode-${mode}${inspectorOpen && mode === "play" ? " inspector-open" : ""}`}>
    <PadKeyboard onPlayedPad={() => updateGuide({ choseSound: true, playedPads: true })} />
    <header className="bl-topbar">
      <div>
        <small>REVERYX / BEAT LAB</small>
        <input className="bl-title" value={project.title} onChange={(event) => runtime.state.setTitle(event.target.value)} aria-label="Beat title" />
      </div>
      <ModeSwitcher mode={mode} onMode={(next) => { setMode(next); if (next !== "play") setInspectorOpen(false); }} />
    </header>
    {showGuide && <FirstUseGuide progress={guide} onDismiss={() => persistGuide({ ...guide, dismissed: true })} />}
    {warning && <div className="bl-banner" role="status">{warning}</div>}
    {vocalLock && <div className="bl-banner lock" role="status">Vocals were recorded against an earlier beat revision. Recorded timing is preserved. Beat Lab will not silently shift those takes.</div>}
    <TransportBar mode={mode} onRecordToBeat={onRecordToBeat} onArmedRecord={() => updateGuide({ pressedRecord: true })} />
    {mode === "play" && <>
      <div className="bl-play-focus">
        <p className="bl-now" role="status">{pattern.name} · {runtime.recording ? "Recording" : runtime.playing ? "Playing" : "Stopped"} · Bank {project.selectedBank}</p>
        <PadGrid
          padRefs={padRefs}
          onPlayedPad={() => updateGuide({ choseSound: true, playedPads: true })}
          onEditPad={(id) => openInspector(id)}
        />
        <PatternStrip />
      </div>
      <PadInspector open={inspectorOpen} modal={modalInspector} title={`Pad ${pad.id}`} onClose={closeInspector}>
        <PadEditor />
      </PadInspector>
    </>}
    {mode === "sample" && <div className="bl-sample-mode">
      <PadGrid
        padRefs={padRefs}
        onPlayedPad={() => updateGuide({ choseSound: true, playedPads: true })}
      />
      <SampleLab onAssignedSound={() => updateGuide({ choseSound: true })} />
      <PadEditor />
    </div>}
    {mode === "sequence" && <>
      <PadGrid
        padRefs={padRefs}
        compact
        onPlayedPad={() => updateGuide({ choseSound: true, playedPads: true })}
      />
      <PatternStrip />
      <PatternEditor />
    </>}
    {mode === "arrange" && <>
      <ArrangementView />
      <ExportPanel announce={announce} />
    </>}
  </div>;
}
