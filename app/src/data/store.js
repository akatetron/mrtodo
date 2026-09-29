// Mr. Todo — data store backed by Supabase (Postgres + realtime + auth).
// Every screen only calls the functions exported here — same names/shapes as
// the original in-memory prototype — so screens didn't need to change when
// this file switched from fake data to a real backend.

import { useEffect, useState, useSyncExternalStore } from 'react';
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

export const STATUS_META = {
  requested: { label: 'Requested' },
  matched: { label: 'Matched' },
  assigned: { label: 'Assigned' },
  in_progress: { label: 'In progress' },
  completed: { label: 'Completed' },
};
export const STAGES = ['requested', 'matched', 'assigned', 'in_progress', 'completed'];

function genOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ---- convert DB rows (snake_case) to the shape screens expect (camelCase) ----
function mapTask(row, visits = []) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    taskType: row.task_type,
    status: row.status,
    scheduledFor: row.scheduled_for,
    location: row.location,
    estCost: row.est_cost,
    ratePerDay: row.rate_per_day,
    forWhom: row.for_whom,
    recipientName: row.recipient_name,
    recipientRelation: row.recipient_relation,
    recipientPhone: row.recipient_phone,
    otp: row.otp,
    assignedWorkerId: row.assigned_worker_id,
    customerId: row.customer_id,
    customerName: row.customer_name || 'Customer',
    customerRating: row.customer_rating ?? 4.5,
    visits: visits.map((v) => ({ date: new Date(v.created_at).toLocaleDateString(), note: v.note, done: v.done })),
  };
}

// ---- tiny external store, now populated from Supabase + realtime ----
let tasks = [];
let workers = [];
const listeners = new Set();
function emit() { listeners.forEach((l) => l()); }
function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function getSnapshot() { return tasks; }

let started = false;
async function ensureStarted() {
  if (started) return;
  started = true;
  await refreshAll();
  supabase
    .channel('tasks-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, refreshAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_visits' }, refreshAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refreshAll)
    .subscribe();
}

async function refreshAll() {
  const [{ data: taskRows }, { data: visitRows }, { data: profileRows }] = await Promise.all([
    supabase.from('tasks').select('*, customer:customer_id(full_name, rating)').order('created_at', { ascending: false }),
    supabase.from('task_visits').select('*').order('created_at', { ascending: true }),
    supabase.from('profiles').select('*'),
  ]);
  const visitsByTask = {};
  (visitRows || []).forEach((v) => { (visitsByTask[v.task_id] ||= []).push(v); });
  tasks = (taskRows || []).map((r) =>
    mapTask({ ...r, customer_name: r.customer?.full_name, customer_rating: r.customer?.rating }, visitsByTask[r.id] || [])
  );
  workers = (profileRows || []).filter((p) => p.role === 'worker');
  emit();
}

export function useTasks() {
  useEffect(() => { ensureStarted(); }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// live worker list, for the suggested-workers panel etc.
export function useWorkers() {
  useTasks(); // shares the same refresh cycle
  return workers;
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

export function queueTasks() {
  return tasks.filter((t) => t.status === 'requested' || t.status === 'matched');
}

export function suggestedWorkers(task) {
  return workers
    .filter((w) => w.online)
    .map((w) => ({ w, score: ((w.categories || []).includes(task.category) ? 2 : 0) + (w.rating || 0) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.w);
}

export async function createTask(input, customerId) {
  const { data, error } = await supabase.from('tasks').insert({
    customer_id: customerId,
    title: input.title,
    description: input.description,
    category: input.category,
    task_type: input.taskType,
    scheduled_for: input.scheduledFor,
    location: input.location,
    est_cost: input.estCost,
    rate_per_day: input.ratePerDay,
    for_whom: input.forWhom,
    recipient_name: input.recipientName,
    recipient_relation: input.recipientRelation,
    otp: genOtp(),
    status: 'requested',
  }).select().single();
  if (error) throw error;
  await refreshAll();
  return mapTask(data);
}

export async function assignWorker(taskId, workerId) {
  await supabase.from('tasks').update({ status: 'assigned', assigned_worker_id: workerId }).eq('id', taskId);
  await refreshAll();
}

export async function acceptTask(taskId) {
  await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', taskId);
  await refreshAll();
}

export async function declineTask(taskId) {
  await supabase.from('tasks').update({ status: 'requested', assigned_worker_id: null }).eq('id', taskId);
  await refreshAll();
}

export async function logVisit(taskId, note) {
  await supabase.from('task_visits').insert({ task_id: taskId, note: note || 'Visit logged.', done: true });
  await refreshAll();
}

export async function completeWithOtp(taskId, code) {
  const t = getTask(taskId);
  if (!t || !t.otp || code !== t.otp) return false;
  await supabase.from('tasks').update({ status: 'completed' }).eq('id', taskId);
  await refreshAll();
  return true;
}

export function visitsDone(t) {
  return (t.visits || []).filter((v) => v.done).length;
}

export function runningTotal(t) {
  if (t.taskType === 'ongoing') return (t.ratePerDay || 0) * visitsDone(t);
  return t.estCost || 0;
}

export function catMeta(id) {
  return CATEGORIES.find((c) => c.id === id) || { label: id, emoji: '•' };
}

export function worker(id) {
  return workers.find((w) => w.id === id) || null;
}
