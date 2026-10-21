// The published catalogue, shared by the discover, category and booking screens.
// Always comes from the database; nothing here is a list of services.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { fetchCatalogue } from './store';

let state = { families: [], loaded: false, failed: false };
let inflight = null;
const listeners = new Set();
const emit = () => { state = { ...state }; listeners.forEach((l) => l()); };

export function reloadCatalogue() {
  if (!inflight) {
    inflight = fetchCatalogue().then(({ families, failed }) => { state = { families: failed ? state.families : families, loaded: true, failed }; emit(); }).finally(() => { inflight = null; });
  }
  return inflight;
}

export function useCatalogue() {
  const snap = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);
  useEffect(() => { reloadCatalogue(); }, []);
  const families = snap.families.filter((f) => f.services?.length > 0);
  const findService = (id) => { for (const f of families) { const s = f.services.find((x) => x.id === id); if (s) return { service: s, family: f }; } return null; };
  return { families, loaded: snap.loaded, failed: snap.failed, findService, reload: reloadCatalogue };
}

// Search over what is actually published: names, descriptions and keywords.
export function searchServices(families, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (const f of families) for (const s of f.services) {
    const d = s.definition || {};
    const hay = `${d.title || ''} ${d.description || ''} ${(d.keywords || []).join(' ')} ${f.name}`.toLowerCase();
    const score = words.every((w) => hay.includes(w)) ? (String(d.title || '').toLowerCase().includes(q) ? 2 : 1) : 0;
    if (score) out.push({ service: s, family: f, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
