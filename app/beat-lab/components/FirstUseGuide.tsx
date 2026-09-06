"use client";

import { isGuideComplete, type FirstUseGuideProgress } from "../core/ux";

export function FirstUseGuide({
  progress,
  onDismiss,
}: {
  progress: FirstUseGuideProgress;
  onDismiss: () => void;
}) {
  const steps = [
    { id: "sound", label: "Choose a sound", done: progress.choseSound },
    { id: "record", label: "Press Record", done: progress.pressedRecord },
    { id: "play", label: "Play the pads", done: progress.playedPads },
  ];
  return <aside className="bl-guide" aria-label="First-use guide">
    <div>
      <small>Get started</small>
      <ol>
        {steps.map((step, index) => (
          <li key={step.id} className={step.done ? "done" : ""}>
            <b>{index + 1}</b>
            <span>{step.label}</span>
            {step.done ? <em>Done</em> : null}
          </li>
        ))}
      </ol>
    </div>
    <button type="button" onClick={onDismiss} aria-label="Dismiss first-use guide">
      {isGuideComplete(progress) ? "Close" : "Dismiss"}
    </button>
  </aside>;
}
