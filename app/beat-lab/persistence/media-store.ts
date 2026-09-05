import type { BeatLabProject } from "../core/project-schema";
import { parseProject, serializeProject } from "../core/project-schema";

const DB_NAME = "reveryx-beat-lab";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";
const ASSET_STORE = "assets";
const ACTIVE_KEY = "reveryx-beat-lab-active-id";

type AssetRecord = { id: string; blob: Blob; mime: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveProjectRecord(project: BeatLabProject): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  const tx = db.transaction(PROJECT_STORE, "readwrite");
  tx.objectStore(PROJECT_STORE).put({
    id: project.id,
    json: serializeProject(project),
    updatedAt: Date.now(),
    title: project.title,
  });
  await txDone(tx);
  db.close();
  try { localStorage.setItem(ACTIVE_KEY, project.id); } catch { /* private mode */ }
}

export async function loadProjectRecord(id: string): Promise<ReturnType<typeof parseProject> | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  const record = await new Promise<{ json: string } | undefined>((resolve, reject) => {
    const request = db.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).get(id);
    request.onsuccess = () => resolve(request.result as { json: string } | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!record?.json) return null;
  return parseProject(record.json);
}

export async function loadActiveProject(): Promise<ReturnType<typeof parseProject> | null> {
  if (typeof indexedDB === "undefined") return null;
  let id = "";
  try { id = localStorage.getItem(ACTIVE_KEY) || ""; } catch { id = ""; }
  if (id) {
    const loaded = await loadProjectRecord(id);
    if (loaded) return loaded;
  }
  const db = await openDb();
  const all = await new Promise<Array<{ json: string; updatedAt: number }>>((resolve, reject) => {
    const request = db.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).getAll();
    request.onsuccess = () => resolve((request.result || []) as Array<{ json: string; updatedAt: number }>);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const latest = all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return latest ? parseProject(latest.json) : null;
}

export async function saveAssetRecord(id: string, blob: Blob, mime: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  const tx = db.transaction(ASSET_STORE, "readwrite");
  tx.objectStore(ASSET_STORE).put({ id, blob, mime } satisfies AssetRecord);
  await txDone(tx);
  db.close();
}

export async function loadAssetRecord(id: string): Promise<AssetRecord | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  const record = await new Promise<AssetRecord | undefined>((resolve, reject) => {
    const request = db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).get(id);
    request.onsuccess = () => resolve(request.result as AssetRecord | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return record || null;
}

export async function listAssetIds(): Promise<Set<string>> {
  if (typeof indexedDB === "undefined") return new Set();
  const db = await openDb();
  const ids = await new Promise<string[]>((resolve, reject) => {
    const request = db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).getAllKeys();
    request.onsuccess = () => resolve((request.result || []) as string[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return new Set(ids.map(String));
}
