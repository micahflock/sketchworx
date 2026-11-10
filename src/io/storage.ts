/** IndexedDB autosave + File System Access save/open with download/upload fallback (iPad). */

// A test copy served beside the main site keeps its own autosave.
const DB_NAME = typeof __APP_CHANNEL__ !== "undefined" && __APP_CHANNEL__ ? `sketchworx-${__APP_CHANNEL__}` : "sketchworx";
const STORE = "autosave";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function autosaveWrite(text: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(text, "current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function autosaveRead(): Promise<string | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  const v = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get("current");
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return v;
}

type FileHandle = { name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(d: string | Blob): Promise<void>; close(): Promise<void> }> };
let currentHandle: FileHandle | null = null;
export const currentFileName = () => currentHandle?.name ?? null;

const fsApi = () => typeof window !== "undefined" && "showSaveFilePicker" in window;

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function saveText(text: string, suggested: string, mime: string, ext: string, saveAs = false): Promise<string | null> {
  if (fsApi()) {
    try {
      let h = saveAs || !currentHandle || !currentHandle.name.endsWith(ext) ? null : currentHandle;
      if (!h) {
        h = await (window as any).showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: "Sketch", accept: { [mime]: [ext] } }],
        });
      }
      const w = await h!.createWritable();
      await w.write(text);
      await w.close();
      if (ext.endsWith(".json")) currentHandle = h;
      return h!.name;
    } catch (e: any) {
      if (e?.name === "AbortError") return null;
      throw e;
    }
  }
  downloadBlob(new Blob([text], { type: mime }), suggested);
  return suggested;
}

export async function openText(accept: string): Promise<{ name: string; text: string } | null> {
  if (fsApi() && "showOpenFilePicker" in window) {
    try {
      const [h] = await (window as any).showOpenFilePicker({
        types: [{ description: "Sketch", accept: { "application/json": [".json"] } }],
      });
      currentHandle = h;
      const f = await h.getFile();
      return { name: f.name, text: await f.text() };
    } catch (e: any) {
      if (e?.name === "AbortError") return null;
      throw e;
    }
  }
  return pickFile(accept).then(async (f) => (f ? { name: f.name, text: await f.text() } : null));
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
