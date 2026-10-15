// Mr. Todo — data store backed by Supabase (Postgres + realtime + storage).
//
// Screens read through the hooks/getters and change things only through the
// action functions below. Every task state change is a database function
// (see supabase/schema.sql section 7), which checks who is calling — the app
// never writes a task status directly.

import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';

export const CATEGORIES = [
  { id: 'handyman', label: 'Handyman', emoji: '🔧' },
  { id: 'cleaning', label: 'Cleaning', emoji: '🧹' },
  { id: 'moving', label: 'Moving', emoji: '📦' },
  { id: 'delivery', label: 'Delivery', emoji: '🚴' },
  { id: 'care', label: 'Errands & Care', emoji: '💙' },
];

export const TEMPLATES = [
  { emoji: '🚰', label: 'Fix a leaking tap', category: 'handyman', title: 'Fix a leaking tap', desc: 'A tap is dripping and needs a look — replace washer/seal if needed.', taskType: 'one-time' },
  { emoji: '🧹', label: 'Deep clean my home', category: 'cleaning', title: 'Deep clean the apartment', desc: 'Full clean of kitchen, bathrooms and all rooms.', taskType: 'one-time' },
  { emoji: '📦', label: 'Help me move', category: 'moving', title: 'Move furniture and boxes', desc: 'Help moving items to a new address, may need a small vehicle.', taskType: 'one-time' },
  { emoji: '🚴', label: 'Pick up / drop something', category: 'delivery', title: 'Pick up and deliver a package', desc: 'Collect an item from one address and deliver it to another.', taskType: 'one-time' },
  { emoji: '🏦', label: 'Help an elderly parent with errands', category: 'care', title: 'Accompany my parent for bank/errand visits', desc: 'Someone to accompany an elderly family member for paperwork, bank visits, or errands — may take more than one visit.', taskType: 'ongoing' },
  { emoji: '💊', label: 'Medicine or grocery run', category: 'care', title: 'Pick up medicines / groceries', desc: 'A short, one-time errand to collect medicines or groceries.', taskType: 'one-time' },
];

// `label` is what the customer sees, `pmLabel` what the Personal Manager sees,
// `adminLabel` what an admin sees.
export const STATUS_META = {
  requested: { label: 'Requested', pmLabel: 'Requested', adminLabel: 'Needs a PM', tone: 'neutral' },
  matched: { label: 'Matched', pmLabel: 'New offer', adminLabel: 'Offered — awaiting PM', tone: 'brass' },
  assigned: { label: 'Assigned', pmLabel: 'Accepted', adminLabel: 'Accepted', tone: 'accent' },
  in_progress: { label: 'In progress', pmLabel: 'In progress', adminLabel: 'In progress', tone: 'accent' },
  completed: { label: 'Completed', pmLabel: 'Completed', adminLabel: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', pmLabel: 'Cancelled', adminLabel: 'Cancelled', tone: 'danger' },
};
export const STAGES = ['requested', 'matched', 'assigned', 'in_progress', 'completed'];

export const PM_SHARE = 0.8; // Personal Manager keeps 80%, platform fee 20%

// ---- helpers -----------------------------------------------------------------

export function initials(name) {
  return (name || '?').split(' ').filter(Boolean).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
}

export function shortId(id) {
  return `MT-${String(id).slice(0, 6).toUpperCase()}`;
}

function mapPerson(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.full_name,
    initials: initials(p.full_name),
    phone: p.phone,
    rating: p.rating == null ? null : Number(p.rating),
    ratingCount: p.rating_count || 0,
    jobsDone: p.jobs_done || 0,
  };
}

function mapTask(row, visits, otp) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    taskType: row.task_type,
    status: row.status,
    scheduledFor: row.scheduled_for,
    location: row.location,
    estCost: row.est_cost == null ? null : Number(row.est_cost),
    ratePerDay: row.rate_per_day == null ? null : Number(row.rate_per_day),
    forWhom: row.for_whom,
    recipientName: row.recipient_name,
    recipientRelation: row.recipient_relation,
    recipientPhone: row.recipient_phone,
    otp: otp || null, // only ever present for the task's own customer
    assignedWorkerId: row.assigned_worker_id,
    customerId: row.customer_id,
    customer: mapPerson(row.customer),
    worker: mapPerson(row.worker),
    customerRatingOfWorker: row.customer_rating_of_worker == null ? null : Number(row.customer_rating_of_worker),
    workerRatingOfCustomer: row.worker_rating_of_customer == null ? null : Number(row.worker_rating_of_customer),
    cancelReason: row.cancel_reason,
    customerReview: row.customer_review,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    assignedAt: row.assigned_at,
    visits: (visits || []).map((v) => ({
      id: v.id,
      date: new Date(v.created_at).toLocaleDateString(),
      note: v.note,
      done: v.done,
    })),
  };
}

// ---- tiny external store, populated from Supabase + realtime ------------------

let tasks = [];
const listeners = new Set();
function emit() { listeners.forEach((l) => l()); }
function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function getSnapshot() { return tasks; }

let channel = null;
let refreshTimer = null;
let generation = 0; // bumps on sign-out so late responses for the old user are dropped

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshAll, 150);
}

async function ensureStarted() {
  if (channel) return;
  channel = supabase
    .channel('tasks-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_visits' }, scheduleRefresh)
    .subscribe();
  await refreshAll();
}

export async function refreshAll() {
  const gen = generation;
  const [taskRes, visitRes, otpRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, customer:customer_id(id, full_name, rating, rating_count, phone), worker:assigned_worker_id(id, full_name, rating, rating_count, jobs_done, phone)')
      .order('created_at', { ascending: false }),
    supabase.from('task_visits').select('*').order('created_at', { ascending: true }),
    supabase.from('task_otps').select('task_id, code'),
  ]);
  if (gen !== generation) return;
  if (taskRes.error) { console.warn('Loading tasks failed:', taskRes.error.message); return; }
  const visitsByTask = {};
  (visitRes.data || []).forEach((v) => { (visitsByTask[v.task_id] ||= []).push(v); });
  const otpByTask = {};
  (otpRes.data || []).forEach((o) => { otpByTask[o.task_id] = o.code; });
  tasks = (taskRes.data || []).map((r) => mapTask(r, visitsByTask[r.id], otpByTask[r.id]));
  emit();
}

// Called by AuthContext whenever the signed-in user changes.
export function resetStore() {
  generation += 1;
  clearTimeout(refreshTimer);
  if (channel) { supabase.removeChannel(channel); channel = null; }
  tasks = [];
  emit();
}

export function useTasks() {
  useEffect(() => { ensureStarted(); }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getTask(id) {
  return tasks.find((t) => t.id === id) || null;
}

export function myTasks(customerId) {
  return tasks.filter((t) => t.customerId === customerId);
}

export function assignedTasksFor(workerId) {
  return tasks.filter((t) => t.assignedWorkerId === workerId);
}

// ---- actions -------------------------------------------------------------------

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  await refreshAll();
  return data;
}

export async function createTask(input, customerId) {
  const { data, error } = await supabase.from('tasks').insert({
    customer_id: customerId,
    title: input.title,
    description: input.description || null,
    category: input.category,
    task_type: input.taskType,
    scheduled_for: input.scheduledFor || null,
    location: input.location,
    est_cost: input.estCost ?? null,
    rate_per_day: input.ratePerDay ?? null,
    for_whom: input.forWhom,
    recipient_name: input.recipientName || null,
    recipient_relation: input.recipientRelation || null,
    recipient_phone: input.recipientPhone || null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  await refreshAll();
  return data;
}

export const acceptTask = (taskId) => rpc('accept_task', { p_task: taskId });
export const declineTask = (taskId, reason) => rpc('decline_task', { p_task: taskId, p_reason: reason || null });
export const startTask = (taskId) => rpc('start_task', { p_task: taskId });
export const logVisit = (taskId, note) => rpc('log_visit', { p_task: taskId, p_note: note || null });
export const cancelTask = (taskId, reason) => rpc('cancel_task', { p_task: taskId, p_reason: reason || null });
export const rateTask = (taskId, rating, review) => rpc('rate_task', { p_task: taskId, p_rating: rating, p_review: review || null });

// Resolves to 'ok', 'wrong' or 'locked'.
export const completeWithOtp = (taskId, code) => rpc('complete_task', { p_task: taskId, p_code: code });

// ---- admin actions (the database refuses all of these for non-admins) ------------

export const assignTask = (taskId, workerId) => rpc('assign_task', { p_task: taskId, p_worker: workerId });
export const adminCompleteTask = (taskId, note) => rpc('admin_complete_task', { p_task: taskId, p_note: note });

// Approved Personal Managers ranked best-first for this task.
export async function listShortlist(taskId) {
  const { data, error } = await supabase.rpc('shortlist_workers', { p_task: taskId });
  if (error) throw new Error(error.message);
  return (data || []).map((w) => ({
    id: w.id,
    name: w.full_name,
    initials: initials(w.full_name),
    rating: w.rating == null ? null : Number(w.rating),
    ratingCount: w.rating_count || 0,
    jobsDone: w.jobs_done || 0,
    serviceArea: w.service_area,
    online: w.online,
    categoryMatch: w.category_match,
    areaMatch: w.area_match,
    declined: w.declined,
    activeJobs: w.active_jobs || 0,
  }));
}

// Everything that has happened to a task, oldest first.
export async function taskHistory(taskId) {
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, action, details, created_at, actor:actor_id(full_name)')
    .eq('entity_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export function timeAgo(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---- Personal Manager application -------------------------------------------------

export async function listMyDocuments(userId) {
  const { data, error } = await supabase.from('pm_documents').select('*').eq('worker_id', userId).order('created_at');
  if (error) throw new Error(error.message);
  return data || [];
}

// `file` is an asset from expo-document-picker: { uri, name, mimeType }.
export async function uploadDocument(userId, docType, label, file, expiresOn) {
  const safeName = (file.name || 'document').replace(/[^\w.\-]+/g, '_');
  const path = `${userId}/${Date.now()}-${safeName}`;
  const body = await (await fetch(file.uri)).arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from('pm-documents')
    .upload(path, body, { contentType: file.mimeType || 'application/octet-stream' });
  if (upErr) throw new Error(upErr.message);
  const { error } = await supabase.from('pm_documents').insert({
    worker_id: userId, doc_type: docType, label: label || file.name, storage_path: path,
    // only sent when given, so this still works on a database without the column
    ...(expiresOn ? { expires_on: expiresOn } : {}),
  });
  if (error) {
    await supabase.storage.from('pm-documents').remove([path]);
    throw new Error(error.message);
  }
}

export async function removeDocument(doc) {
  const { error } = await supabase.from('pm_documents').delete().eq('id', doc.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from('pm-documents').remove([doc.storage_path]);
}

export async function submitApplication(a) {
  const { error } = await supabase.rpc('submit_pm_application', {
    p_full_name: a.fullName,
    p_phone: a.phone,
    p_bio: a.bio,
    p_categories: a.categories,
    p_experience_years: a.experienceYears,
    p_service_area: a.serviceArea,
  });
  if (error) throw new Error(error.message);
}

export async function updateMyProfile(userId, fields) {
  const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
  if (error) throw new Error(error.message);
}

// ---- derived values -------------------------------------------------------------

export function visitsDone(t) {
  return (t.visits || []).filter((v) => v.done).length;
}

export function runningTotal(t) {
  if (t.taskType === 'ongoing') return (t.ratePerDay || 0) * visitsDone(t);
  return t.estCost || 0;
}

export function pmEarning(t) {
  return Math.round(runningTotal(t) * PM_SHARE);
}

export function catMeta(id) {
  return CATEGORIES.find((c) => c.id === id) || { label: id, emoji: '•' };
}

export function formatRating(r, count) {
  if (r == null) return 'New';
  return `★ ${Number(r).toFixed(1)}${count ? ` (${count})` : ''}`;
}
