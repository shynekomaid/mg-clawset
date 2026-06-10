/**
 * Remembers the user's Mewgenics savefile via the File System Access API so
 * "Re-load savegame" can re-read it from disk in one click. Handles are
 * structured-cloneable, so they persist in IndexedDB (not localStorage).
 * Chromium-only; callers must fall back to a normal file picker elsewhere.
 */

// File System Access API surface not yet in lib.dom
declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      types?: { description?: string; accept: Record<string, string[]> }[];
      multiple?: boolean;
    }) => Promise<FileSystemFileHandle[]>;
  }
  interface FileSystemFileHandle {
    queryPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  }
}

const DB_NAME = 'mg-clawset';
const STORE = 'file-handles';
const KEY = 'savefile';

export function isFilePickerSupported(): boolean {
  return typeof window.showOpenFilePicker === 'function';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSavefileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSavefileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

/**
 * Re-read the remembered savefile. Returns null when there is no stored
 * handle, permission was denied, or the file is gone — caller should fall
 * back to the import dialog.
 */
export async function readRememberedSavefile(): Promise<{ data: Uint8Array; name: string } | null> {
  const handle = await loadSavefileHandle();
  if (!handle) return null;
  try {
    let perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (perm !== 'granted') {
      perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
    }
    if (perm !== 'granted') return null;
    const file = await handle.getFile();
    return { data: new Uint8Array(await file.arrayBuffer()), name: file.name };
  } catch {
    return null;
  }
}
