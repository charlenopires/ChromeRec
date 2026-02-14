// Dexie.js database for storing recorded video blobs and metadata.

import Dexie, { type EntityTable } from "dexie";

// --- Recording entry schema ---

export interface Recording {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  durationMs: number;
  createdAt: number;
  tabTitle: string;
  blob: Blob;
}

// Metadata-only view (without blob) for list display
export type RecordingMeta = Omit<Recording, "blob">;

// --- Database ---

const db = new Dexie("ChromeRecDB") as Dexie & {
  recordings: EntityTable<Recording, "id">;
};

db.version(1).stores({
  recordings: "++id, createdAt",
});

// --- CRUD operations ---

export async function saveRecording(
  entry: Omit<Recording, "id">,
): Promise<number> {
  return db.recordings.add(entry as Recording);
}

export async function getRecording(id: number): Promise<Recording | undefined> {
  return db.recordings.get(id);
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const all = await db.recordings
    .orderBy("createdAt")
    .reverse()
    .toArray();

  // Strip blobs for list display to avoid holding large data in memory
  return all.map(({ blob: _blob, ...meta }) => meta);
}

export async function deleteRecording(id: number): Promise<void> {
  await db.recordings.delete(id);
}

export async function getStorageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return {
    usage: usage ?? 0,
    quota: quota ?? 0,
  };
}

export { db };
