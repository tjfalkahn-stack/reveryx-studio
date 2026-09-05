"use client";

import { useState, useSyncExternalStore } from "react";
import JSZip from "jszip";
import { PRO_TOOLS_SAMPLE_RATE } from "../../audio/bwf";
import { useStudioSession } from "../../session/studio-session";
import { useBeatLabRuntime } from "./runtime-context";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportPanel({ announce }: { announce: (message: string) => void }) {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  const session = useStudioSession();
  const [busy, setBusy] = useState("");

  async function exportPackage(includeVocals: boolean) {
    setBusy("Rendering aligned stems…");
    try {
      const zip = new JSZip();
      const audio = zip.folder("Audio Files");
      const title = project.title.replace(/[^a-z0-9-_]+/gi, "-") || "beat";
      const stems: Array<["master" | "drums" | "sample" | "bass" | "instrument", string]> = [
        ["master", `${title}-BEAT-FROM-SESSION-START.wav`],
        ["drums", `${title}-DRUMS-FROM-SESSION-START.wav`],
        ["sample", `${title}-SAMPLE-FROM-SESSION-START.wav`],
        ["bass", `${title}-BASS-FROM-SESSION-START.wav`],
        ["instrument", `${title}-INSTRUMENT-FROM-SESSION-START.wav`],
      ];
      for (const [bus, name] of stems) {
        setBusy(`Rendering ${name}…`);
        audio?.file(name, runtime.renderStemWav(bus, `${project.title} / ${bus} / session start`));
      }
      if (includeVocals) {
        for (const [index, track] of session.sessionBeat.importedTracks.filter((item) => item.role === "VOCAL").entries()) {
          try {
            const decoded = await (await fetch(track.url)).blob();
            zip.folder("Original Browser Captures")?.file(track.name, decoded);
            void index;
          } catch { /* original remains in the recorder take vault */ }
        }
      }
      zip.file("REVERYX Beat Lab Manifest.json", JSON.stringify(runtime.exportManifest(), null, 2));
      zip.file("Section Markers.csv", ["name,kind,start_seconds,end_seconds", ...project.arrangement.map((section, index) => {
        const placed = runtime.exportManifest().sections[index];
        return `"${section.name}","${section.kind}",${placed?.startSeconds ?? 0},${placed?.endSeconds ?? 0}`;
      })].join("\n"));
      zip.file("START HERE.txt", [
        `REVERYX BEAT LAB — ${project.title}`,
        "",
        `Tempo: ${project.bpm} BPM`,
        "Meter: 4/4",
        "All WAV stems are 48 kHz / 24-bit Broadcast WAV aligned at 0:00.000.",
        "Import every FROM-SESSION-START file at session origin in Pro Tools or Logic.",
        "MP3 and AI stem separation are not included because they are not implemented.",
      ].join("\n"));
      setBusy("Packaging…");
      download(await zip.generateAsync({ type: "blob", compression: "STORE" }), `${title}-REVERYX-BeatLab.zip`);
      announce("Beat Lab export downloaded with aligned beat and stems.");
    } catch {
      announce("Export could not finish on this device. The Beat Lab project remains saved locally.");
    } finally {
      setBusy("");
    }
  }

  return <section className="bl-export" aria-label="Export">
    <small>Export · 48 kHz / 24-bit WAV</small>
    <button type="button" disabled={Boolean(busy)} onClick={() => download(runtime.renderStemWav("master", `${project.title} beat`), `${project.title.replace(/[^a-z0-9-_]+/gi, "-")}-beat.wav`)}>Full beat WAV</button>
    <button type="button" disabled={Boolean(busy)} onClick={() => void exportPackage(false)}>{busy || "Aligned beat + stems"}</button>
    <button type="button" disabled={Boolean(busy)} onClick={() => download(new Blob([JSON.stringify(runtime.exportManifest(), null, 2)], { type: "application/json" }), `${project.title.replace(/[^a-z0-9-_]+/gi, "-")}-manifest.json`)}>Project manifest</button>
    <p>Stems share the same origin. Vocals stay on their recorded timestamps in the existing SessionPort / Pro Tools Bridge path. Sample rate {PRO_TOOLS_SAMPLE_RATE} Hz.</p>
  </section>;
}
