"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { selectedPad } from "../core/project-schema";
import { STARTER_KIT } from "../core/starter-kit";
import { useBeatLabRuntime } from "./runtime-context";

export function SampleLab() {
  const runtime = useBeatLabRuntime();
  const project = useSyncExternalStore(runtime.state.subscribe, runtime.state.getSnapshot, runtime.state.getSnapshot);
  const pad = selectedPad(project);
  const asset = project.assets.find((item) => item.id === pad.assetId) || null;
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState(0);
  const [recording, setRecording] = useState(false);
  const pcm = runtime.sourcePcm(pad);

  const view = useMemo(() => {
    const duration = asset?.duration || (pcm ? pcm.length / 48000 : pad.end);
    const window = duration / zoom;
    const start = Math.min(Math.max(0, offset), Math.max(0, duration - window));
    return { duration, window, start, end: start + window };
  }, [asset, pcm, pad.end, zoom, offset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pcm) return;
    const width = canvas.width = canvas.clientWidth * 2 || 800;
    const height = canvas.height = 160;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#080e10";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#43e7ff";
    ctx.beginPath();
    const startSample = Math.floor((view.start / Math.max(view.duration, 0.01)) * pcm.length);
    const endSample = Math.max(startSample + 1, Math.floor((view.end / Math.max(view.duration, 0.01)) * pcm.length));
    const step = Math.max(1, Math.floor((endSample - startSample) / width));
    for (let x = 0; x < width; x++) {
      let min = 1;
      let max = -1;
      const from = startSample + x * step;
      for (let index = from; index < from + step && index < pcm.length; index++) {
        const sample = pcm[index] || 0;
        min = Math.min(min, sample);
        max = Math.max(max, sample);
      }
      const y1 = height / 2 - max * (height * 0.45);
      const y2 = height / 2 - min * (height * 0.45);
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
    }
    ctx.stroke();
    const trimStart = ((pad.start - view.start) / view.window) * width;
    const trimEnd = ((pad.end - view.start) / view.window) * width;
    ctx.fillStyle = "rgba(217,255,72,.12)";
    ctx.fillRect(trimStart, 0, Math.max(2, trimEnd - trimStart), height);
  }, [pcm, view, pad.start, pad.end]);

  useEffect(() => {
    const node = dropRef.current;
    if (!node) return;
    const over = (event: DragEvent) => { event.preventDefault(); node.classList.add("drop"); };
    const leave = () => node.classList.remove("drop");
    const drop = (event: DragEvent) => {
      event.preventDefault();
      node.classList.remove("drop");
      void runtime.importFiles(Array.from(event.dataTransfer?.files || []));
    };
    node.addEventListener("dragover", over);
    node.addEventListener("dragleave", leave);
    node.addEventListener("drop", drop);
    return () => {
      node.removeEventListener("dragover", over);
      node.removeEventListener("dragleave", leave);
      node.removeEventListener("drop", drop);
    };
  }, [runtime]);

  return <section className="bl-sample-lab" ref={dropRef} aria-label="Sample lab">
    <header>
      <div>
        <small>Sample lab</small>
        <strong>{asset?.name || (pad.starterKey ? STARTER_KIT.find((item) => item.key === pad.starterKey)?.name : "No user sample")}</strong>
      </div>
      <div className="bl-sample-actions">
        <button type="button" onClick={() => fileRef.current?.click()}>Import</button>
        <button type="button" disabled={recording} onClick={() => { setRecording(true); void runtime.recordSample(3).finally(() => setRecording(false)); }}>{recording ? "Recording…" : "Mic sample"}</button>
        <button type="button" onClick={() => { const buffer = runtime.padBuffer(pad); if (buffer) void runtime.triggerPad(pad.id); }}>Audition</button>
      </div>
      <input ref={fileRef} className="file-input" type="file" accept="audio/*,.wav,.mp3,.aif,.aiff,.m4a,.ogg,.flac" multiple onChange={(event) => { void runtime.importFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
    </header>
    <div className="bl-browser">
      {STARTER_KIT.map((sound) => (
        <button key={sound.key} type="button" className={pad.starterKey === sound.key ? "active" : ""} onClick={() => runtime.state.patchPad(pad.id, { starterKey: sound.key, assetId: null, name: sound.name, color: sound.color, end: sound.end, stemBus: sound.stem, chokeGroup: sound.chokeGroup }, "Assign starter")}>{sound.name}</button>
      ))}
      {project.assets.map((item) => (
        <button key={item.id} type="button" className={pad.assetId === item.id ? "active" : ""} onClick={() => runtime.state.patchPad(pad.id, { assetId: item.id, starterKey: null, name: item.name.replace(/\.[^.]+$/, "").slice(0, 24), start: 0, end: item.duration, stemBus: "sample" }, "Assign sample")}>{item.missing ? `Missing · ${item.name}` : item.name}</button>
      ))}
    </div>
    <canvas ref={canvasRef} className="bl-wave" aria-label="Sample waveform" onClick={(event) => {
      if (!asset) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const time = view.start + ((event.clientX - rect.left) / rect.width) * view.window;
      runtime.state.addManualSlice(asset.id, time);
    }} />
    <div className="bl-wave-tools">
      <label>Zoom <input type="range" min={1} max={16} step={0.1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      <label>Position <input type="range" min={0} max={100} value={Math.round((view.start / Math.max(view.duration, 0.01)) * 100)} onChange={(event) => setOffset((Number(event.target.value) / 100) * view.duration)} /></label>
      <button type="button" onClick={() => runtime.state.patchPad(pad.id, { fadeIn: 0.008, fadeOut: 0.012 }, "Fades")}>Short fades</button>
      <button type="button" onClick={() => { const samples = runtime.sourcePcm(pad); if (samples) runtime.state.normalizeSelectedPad(samples); }}>Normalize</button>
      <button type="button" onClick={() => runtime.state.patchPad(pad.id, { reverse: !pad.reverse }, "Reverse")}>Reverse</button>
      {[2, 4, 8, 16].map((count) => asset && <button key={count} type="button" onClick={() => runtime.state.equalSlices(asset.id, count as 2 | 4 | 8 | 16)}>Divide {count}</button>)}
      <button type="button" disabled={!asset} onClick={() => void runtime.autoSliceSelected()}>Auto slice</button>
      <button type="button" disabled={!asset} onClick={() => asset && runtime.state.assignSlicesToPads(asset.id)}>Assign slices</button>
      <button type="button" onClick={() => void runtime.resampleSelectedToEmptyPad()}>Resample to new pad</button>
    </div>
    {asset && <ul className="bl-slices">{asset.sliceMarkers.map((marker, index) => (
      <li key={marker.id}>
        <span>Slice {index + 1}</span>
        <input type="number" step={0.001} min={0} max={asset.duration} value={marker.time} onChange={(event) => runtime.state.moveSlice(asset.id, index, Number(event.target.value))} />
        <button type="button" onClick={() => runtime.state.patchPad(pad.id, { start: marker.time, end: asset.sliceMarkers[index + 1]?.time || asset.duration }, "Audition slice")}>Audition region</button>
      </li>
    ))}</ul>}
    {asset?.provenance && <dl className="bl-vault">
      <div><dt>Pack</dt><dd>{asset.provenance.pack}</dd></div>
      <div><dt>Creator</dt><dd>{asset.provenance.creator}</dd></div>
      <div><dt>License</dt><dd>{asset.provenance.license}</dd></div>
      <div><dt>Source</dt><dd>{asset.provenance.source}</dd></div>
    </dl>}
    {!asset && pad.starterKey && <p className="bl-kit-note">Starter sounds are synthesized by REVERYX. They are not copied from a commercial pad bank.</p>}
  </section>;
}
