import type { BeatLabProject } from "./project-schema";

export type HistoryEntry = {
  label: string;
  project: BeatLabProject;
};

export class ProjectHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private readonly limit: number;

  constructor(limit = 80) {
    this.limit = limit;
  }

  snapshot(label: string, project: BeatLabProject) {
    this.past.push({ label, project: structuredClone(project) });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: BeatLabProject): { project: BeatLabProject; label: string } | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ label: entry.label, project: structuredClone(current) });
    return { project: structuredClone(entry.project), label: entry.label };
  }

  redo(current: BeatLabProject): { project: BeatLabProject; label: string } | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ label: entry.label, project: structuredClone(current) });
    return { project: structuredClone(entry.project), label: entry.label };
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}
