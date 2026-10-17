// Mr. Todo — features added after the first release: notifications, reports,
// proof-of-work photos, document expiry, CSV export.
//
// Every function here talks to tables from the second round of schema.sql. If
// someone runs the app before re-running that file, those tables don't exist:
// nothing here throws into the rest of the app. Hooks report `unavailable`
// and screens hide or explain the feature instead of crashing.

import { useSyncExternalStore } from 'react';
import { Platform, Share } from 'react-native';
import { supabase } from '../lib/supabase';
import { refreshAll } from './store';

import { isMissingFeature, UPDATE_HINT } from '../lib/errors';
export { isMissingFeature, UPDATE_HINT };

// ---- notifications ---------------------------------------------------------------

let nState = { items: [], unread: 0, unavailable: false, loaded: false };
const nListeners = new Set();
const nEmit = () => nListeners.forEach((l) => l());
let nChannel = null;
let nUser = null;
let nTimer = null;

async function loadNotifications() {
  const userId = nUser;
  const { data, error } = await supabase
    .from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  if (userId !== nUser) return; // signed out or switched while loading
  if (error) {
    nState = { items: [], unread: 0, unavailable: isMissingFeature(error), loaded: true };
  } else {
    nState = { items: data, unread: data.filter((n) => !n.read_at).length, unavailable: false, loaded: true };
  }
  nEmit();
  refreshAll();   // a notification usually means a task changed; offers reach a PM this way
}

export function startNotifications(userId) {
  if (nUser === userId) return;
  stopNotifications();
  nUser = userId;
  loadNotifications();
  nChannel = supabase
    .channel(`notifications-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => {
      clearTimeout(nTimer);
      nTimer = setTimeout(loadNotifications, 150);
    })
    .subscribe();
}

export function stopNotifications() {
  clearTimeout(nTimer);
  if (nChannel) { supabase.removeChannel(nChannel); nChannel = null; }
  nUser = null;
  nState = { items: [], unread: 0, unavailable: false, loaded: false };
  nEmit();
}

export function useNotifications() {
  return useSyncExternalStore(
    (cb) => { nListeners.add(cb); return () => nListeners.delete(cb); },
    () => nState,
    () => nState,
  );
}

export async function markNotificationsRead(ids) {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids || null });
  if (error) throw new Error(error.message);
  await loadNotifications();
}

// ---- reports ----------------------------------------------------------------------

export const REPORT_REASONS = [
  { id: 'no_show', label: "Didn't show up" },
  { id: 'late', label: 'Arrived late' },
  { id: 'quality', label: 'Poor quality of work' },
  { id: 'behaviour', label: 'Behaviour or attitude' },
  { id: 'safety', label: 'Safety concern' },
  { id: 'payment', label: 'Payment issue' },
  { id: 'other', label: 'Something else' },
];

export async function reportTask(taskId, reason, details) {
  const { error } = await supabase.rpc('report_task', { p_task: taskId, p_reason: reason, p_details: details || null });
  if (error) throw new Error(isMissingFeature(error) ? UPDATE_HINT : error.message);
}

// Reports the signed-in person raised on this task (their own only).
export async function myReportsFor(taskId) {
  const { data, error } = await supabase.from('reports').select('*').eq('task_id', taskId).order('created_at', { ascending: false });
  if (error) return [];
  return data;
}

// ---- proof-of-work photos ------------------------------------------------------------

export async function listPhotos(taskId) {
  const { data, error } = await supabase.from('task_photos').select('*').eq('task_id', taskId).order('created_at');
  if (error) return { photos: [], unavailable: isMissingFeature(error) };
  if (!data.length) return { photos: [], unavailable: false };
  const { data: urls } = await supabase.storage.from('task-photos').createSignedUrls(data.map((p) => p.storage_path), 3600);
  const byPath = {};
  (urls || []).forEach((u) => { if (u.path) byPath[u.path] = u.signedUrl; });
  return { photos: data.map((p) => ({ ...p, url: byPath[p.storage_path] || null })), unavailable: false };
}

const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// `file` is an asset from expo-document-picker: { uri, name, mimeType }.
// The file name and the row carry what the database checks: a name of the form
// <task>/<kind>-<id>.<ext>, the file type and its size. A retake of a Before or
// After replaces the first one.
export async function uploadPhoto(taskId, kind, file) {
  const ext = (file.name || '').split('.').pop().toLowerCase();
  let contentType = (file.mimeType || '').toLowerCase();
  if (!PHOTO_TYPES[contentType]) contentType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' }[ext] || 'image/jpeg';
  const clientId = newId();
  const path = `${taskId}/${kind}-${clientId}.${PHOTO_TYPES[contentType]}`;
  const body = await (await fetch(file.uri)).arrayBuffer();
  if (body.byteLength > 10 * 1024 * 1024) throw new Error('That photo is too large. Pick one under 10 MB.');
  if (!body.byteLength) throw new Error('That photo is empty. Pick another one.');

  if (kind === 'before' || kind === 'after') {
    const { data: old } = await supabase.from('task_photos').select('id, storage_path').eq('task_id', taskId).eq('kind', kind);
    for (const p of old || []) await removePhoto(p).catch(() => {});
  }

  const { error: upErr } = await supabase.storage.from('task-photos').upload(path, body, { contentType });
  if (upErr) throw new Error(isMissingFeature(upErr) ? UPDATE_HINT : upErr.message);

  const row = { task_id: taskId, kind, storage_path: path, client_id: clientId, content_type: contentType, size_bytes: body.byteLength };
  let { error } = await supabase.from('task_photos').insert(row);
  if (error && /column|schema cache/i.test(error.message)) {       // database not updated yet: the first release's columns
    ({ error } = await supabase.from('task_photos').insert({ task_id: taskId, kind, storage_path: path }));
  }
  if (error) {
    await supabase.storage.from('task-photos').remove([path]);
    throw new Error(isMissingFeature(error) ? UPDATE_HINT : error.message);
  }
}

export async function removePhoto(photo) {
  const { error } = await supabase.from('task_photos').delete().eq('id', photo.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from('task-photos').remove([photo.storage_path]);
}

// ---- document expiry --------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

// { days, state } for a document with an expiry date, else null.
// state: 'expired' | 'soon' (within 30 days) | 'ok'
export function docExpiry(doc) {
  if (!doc?.expires_on) return null;
  const days = Math.ceil((new Date(`${doc.expires_on}T23:59:59`).getTime() - Date.now()) / DAY);
  return { days, state: days < 0 ? 'expired' : days <= 30 ? 'soon' : 'ok' };
}

export function expiryText(doc) {
  const e = docExpiry(doc);
  if (!e) return '';
  if (e.state === 'expired') return `Expired ${-e.days} day${e.days === -1 ? '' : 's'} ago`;
  if (e.days === 0) return 'Expires today';
  return `Expires in ${e.days} day${e.days === 1 ? '' : 's'}`;
}

// "2027-03-31" -> true. Rejects typos like 31/03/2027 so a bad date never reaches the database.
export function isValidDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

// ---- CSV export ---------------------------------------------------------------------------

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.map(csvCell).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}

// Browser: downloads a file. Phone: opens the share sheet (Files, email, WhatsApp…).
export async function exportCsv(name, rows) {
  const csv = toCsv(rows);
  if (!csv) throw new Error('Nothing to export yet.');
  const file = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return file;
  }
  await Share.share({ title: file, message: csv });
  return file;
}
