// Photos taken with no signal wait here and upload when the connection returns.
// What is kept: which task, which kind (Before/After) and where the photo file is
// on this phone. The completion code is never kept: it is typed in when the job
// is submitted, and the server decides whether to accept it. The task stays
// "in progress" until the server confirms completion.
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadPhoto } from './extras';

const KEY = 'mrtodo.offline.photos.v1';
let items = [];            // { id, taskId, kind, file: {uri, name, mimeType}, attempts, error, createdAt }
let loaded = false;
let busy = false;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

async function load() {
  if (loaded) return;
  try { items = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); } catch { items = []; }
  loaded = true; emit();
}
async function save() { try { await AsyncStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage full or blocked: the queue still works until restart */ } }

// A failure that is the network's fault (retry later), not the server refusing.
export function isNetworkError(e) {
  return /network request failed|failed to fetch|network error|timeout|load failed/i.test(String(e?.message || e));
}

export async function enqueuePhoto(taskId, kind, file) {
  await load();
  items = items.filter((i) => !(i.taskId === taskId && i.kind === kind && ['before', 'after'].includes(kind)));   // a retake replaces the waiting one
  items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, taskId, kind, file, attempts: 0, error: null, createdAt: Date.now() });
  await save(); emit();
}

export async function processQueue() {
  await load();
  if (busy || !items.length) return;
  busy = true;
  try {
    for (const it of [...items]) {
      try {
        await uploadPhoto(it.taskId, it.kind, it.file);
        items = items.filter((x) => x.id !== it.id);
      } catch (e) {
        if (isNetworkError(e)) { it.attempts += 1; it.error = null; break; }      // still offline: stop and try again later
        // The server refused (task cancelled, reassigned or finished): keep it visible with the reason, do not retry forever.
        it.attempts += 1; it.error = e.message;
      }
      await save(); emit();
    }
  } finally { busy = false; await save(); emit(); }
}
export async function discard(id) { items = items.filter((x) => x.id !== id); await save(); emit(); }
export async function retryAll() { items.forEach((i) => { i.error = null; }); await save(); emit(); return processQueue(); }

load();
setInterval(() => { if (items.some((i) => !i.error)) processQueue(); }, 20000);

let snapshot = { items: [] };
const getSnapshot = () => { if (snapshot.items !== items) snapshot = { items }; return snapshot; };
export function useOfflineQueue() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, getSnapshot, getSnapshot);
}
