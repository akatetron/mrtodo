// Mr. Todo — data store backed by Supabase (Postgres + realtime + storage).
//
// Screens read through the hooks/getters and change things only through the
// action functions below. Every task state change is a database function
// (see supabase/schema.sql section 7), which checks who is calling — the app
// never writes a task status directly.

import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { isMissingFeature, UPDATE_HINT } from '../lib/errors';

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
    rating: p.rating == null ? null : Number(p.rating),
    ratingCount: p.rating_count || 0,
    jobsDone: p.jobs_done || 0,
  };
}

function mapTask(row, visits) {
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
    currency: row.currency || 'INR',
    priceStatus: row.price_status || 'confirmed',   // older databases have no price states: treat their tasks as settled
    priceSource: row.price_source || null,
    templateId: row.template_id || null,
    bookingId: row.booking_id || null,
    serviceId: row.service_id || null,
    serviceVersion: row.service_version || null,
    serviceSnapshot: row.service_snapshot || null,
    reviewState: row.review_state || 'none',
    scheduleKind: row.schedule_kind || 'single_day',
    schedulePlan: row.schedule_plan || null,
    scopeVersion: row.scope_version || 1,
    extraAmount: row.extra_amount == null ? 0 : Number(row.extra_amount),
    pmShareBps: row.pm_share_bps == null ? null : row.pm_share_bps,
    isPremium: !!row.is_premium,
    routingMode: row.routing_mode || 'admin',
    estDurationMinutes: row.est_duration_minutes || null,
    priceApprovedAt: row.price_approved_at || null,
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

// An offer a PM has not accepted yet. The database gives only the area (never the
// street address) and no customer details, so those fields stay empty here.
function mapOffer(o, workerId) {
  return {
    id: o.id, title: o.title, description: o.description, category: o.category, taskType: o.task_type,
    status: o.status, scheduledFor: o.scheduled_for, location: o.area, masked: true,
    estCost: o.est_cost == null ? null : Number(o.est_cost), ratePerDay: o.rate_per_day == null ? null : Number(o.rate_per_day),
    currency: o.currency || 'INR', priceStatus: o.price_status, isPremium: !!o.is_premium,
    estDurationMinutes: o.est_duration_minutes || null, earnShareBps: o.earn_share_bps,
    forWhom: 'self', assignedWorkerId: workerId, customerId: null, customer: null, worker: null,
    assignedAt: o.assigned_at, createdAt: o.created_at, completedAt: null, visits: [],
    customerRatingOfWorker: null, workerRatingOfCustomer: null,
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
let storeUserId = null;
export function setStoreUser(id) { storeUserId = id || null; }

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
  const [taskRes, visitRes, offerRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, customer:customer_id(id, full_name, rating, rating_count), worker:assigned_worker_id(id, full_name, rating, rating_count, jobs_done)')
      .order('created_at', { ascending: false }),
    supabase.from('task_visits').select('*').order('created_at', { ascending: true }),
    supabase.rpc('pm_offers'),     // only a PM gets rows; everyone else (and an old database) gets none
  ]);
  if (gen !== generation) return;
  if (taskRes.error) { console.warn('Loading tasks failed:', taskRes.error.message); return; }
  const visitsByTask = {};
  (visitRes.data || []).forEach((v) => { (visitsByTask[v.task_id] ||= []).push(v); });
  const mapped = (taskRes.data || []).map((r) => mapTask(r, visitsByTask[r.id]));
  const known = new Set(mapped.map((t) => t.id));
  const offers = offerRes.error ? [] : (offerRes.data || []).filter((o) => !known.has(o.id)).map((o) => mapOffer(o, storeUserId));
  tasks = [...offers, ...mapped];
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

export function tasksNow() { return tasks; }

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

export function newRequestId() {
  const hex = '0123456789abcdef';
  const pick = (n) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('');
  return `${pick(8)}-${pick(4)}-4${pick(3)}-a${pick(3)}-${pick(12)}`;
}

// The customer says what they need. The price is never part of it: a template
// brings its own approved price, and anything else is priced by an admin, who
// the customer then confirms (see confirmTaskPrice).
export async function createTask(input, customerId) {
  const requestId = input.requestId || newRequestId();     // kept by the caller across retries
  const { data, error } = await supabase.from('tasks').insert({
    customer_id: customerId,
    title: input.title,
    description: input.description || null,
    category: input.category,
    task_type: input.taskType,
    scheduled_for: input.scheduledFor || null,
    location: input.location,
    template_id: input.templateId || null,
    for_whom: input.forWhom,
    recipient_name: input.recipientName || null,
    recipient_relation: input.recipientRelation || null,
    recipient_phone: input.recipientPhone || null,
    client_request_id: requestId,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') {      // this exact request was already saved: use that task
      const { data: existing } = await supabase.from('tasks').select('id').eq('client_request_id', requestId).maybeSingle();
      if (existing) { await refreshAll(); return existing; }
    }
    // Older databases do not have these columns yet: post the old way.
    if (isMissingFeature(error) || /client_request_id|template_id/.test(error.message)) {
      const fallback = await supabase.from('tasks').insert({
        customer_id: customerId, title: input.title, description: input.description || null, category: input.category,
        task_type: input.taskType, scheduled_for: input.scheduledFor || null, location: input.location,
        for_whom: input.forWhom, recipient_name: input.recipientName || null, recipient_relation: input.recipientRelation || null,
      }).select('id').single();
      if (fallback.error) throw new Error(fallback.error.message);
      await refreshAll();
      return fallback.data;
    }
    throw new Error(error.message);
  }
  await refreshAll();
  return data;
}

export const acceptTask = (taskId) => rpc('accept_task', { p_task: taskId });
export const declineTask = (taskId, reason) => rpc('decline_task', { p_task: taskId, p_reason: reason || null });
export const startTask = (taskId) => rpc('start_task', { p_task: taskId });
export const logVisit = (taskId, note) => rpc('log_visit', { p_task: taskId, p_note: note || null });
export const cancelTask = (taskId, reason) => rpc('cancel_task', { p_task: taskId, p_reason: reason || null });
export const rateTask = (taskId, rating, review) => rpc('rate_task', { p_task: taskId, p_rating: rating, p_review: review || null });

// Resolves to one of: ok, wrong, locked, expired, no_code, missing_evidence, rate_limited.
// `requestKey` stays the same across retries of one completion, so a repeat after a
// dropped connection cannot complete the task twice.
export async function completeWithOtp(taskId, code, requestKey) {
  let res = await supabase.rpc('complete_task', { p_task: taskId, p_code: code, p_idempotency_key: requestKey || null });
  if (res.error && isMissingFeature(res.error)) {
    res = await supabase.rpc('complete_task', { p_task: taskId, p_code: code });   // database not updated yet
  }
  if (res.error) throw new Error(res.error.message);
  await refreshAll();
  return res.data;
}

// What each result means, in words a Personal Manager can act on.
export const COMPLETION_MESSAGES = {
  wrong: 'That code is not right. Ask the customer to read it out again.',
  locked: 'Too many wrong codes. Ask the customer to tap "Show a new code" in their app.',
  expired: 'That code has expired. Ask the customer to tap "Show a new code".',
  no_code: 'The customer has not shown a code yet. Ask them to tap "Show my completion code".',
  missing_evidence: 'Add a Before and an After photo first.',
  rate_limited: 'Too many tries in a short time. Wait a few minutes, then try again.',
};

// The customer shows a code to the Personal Manager when the work is done.
// Asking again replaces the old one. The code is only ever returned here, once.
export async function issueCompletionCode(taskId) {
  const { data, error } = await supabase.rpc('issue_completion_code', { p_task: taskId });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return { code: row.completion_code, validUntil: row.valid_until };
  }
  if (isMissingFeature(error)) {      // database not updated yet: the old way, where the customer could read it
    const legacy = await supabase.from('task_otps').select('code').eq('task_id', taskId).maybeSingle();
    if (legacy.data?.code) return { code: legacy.data.code, validUntil: null };
  }
  throw new Error(error.message);
}

export async function completionCodeState(taskId) {
  const { data, error } = await supabase.rpc('completion_code_state', { p_task: taskId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { active: row.active, locked: row.locked, expired: row.expired, validUntil: row.valid_until } : null;
}

// ---- prices ----------------------------------------------------------------------

export const confirmTaskPrice = (taskId) => rpc('confirm_task_price', { p_task: taskId });
export const approveTaskPrice = (taskId, amount, note) => rpc('approve_task_price', { p_task: taskId, p_amount: amount, p_note: note || null });

// Approved Standard Templates a customer can start from. Empty on an older database.
export async function listTemplates() {
  const { data, error } = await supabase.from('task_templates')
    .select('id, key, name, category, description, pricing_mode, price, currency, est_duration_minutes, is_premium')
    .eq('is_active', true).order('name');
  return error ? [] : data || [];
}

// How the price of a task reads to the person looking at it.
//   template + confirmed   -> "₹650 · standard price"
//   admin price, waiting   -> "₹750 · confirm to go ahead"
//   no price yet           -> "Price being set"
export function priceSummary(t) {
  const amount = t.taskType === 'ongoing' ? t.ratePerDay : t.estCost;
  const sym = (t.currency || 'INR') === 'INR' ? '₹' : `${t.currency} `;
  const money = amount == null ? null : `${sym}${Number(amount).toLocaleString('en-IN')}${t.taskType === 'ongoing' ? '/day' : ''}`;
  if (t.priceStatus === 'awaiting_approval' || amount == null) {
    return { label: 'Price being set', detail: 'Our team prices tasks like this one, usually within a few minutes. You confirm it before work starts.', tone: 'neutral', amount: null };
  }
  if (t.priceStatus === 'awaiting_confirmation') {
    return { label: money, detail: 'Waiting for you to confirm this price.', tone: 'brass', amount: money };
  }
  return { label: money, detail: t.priceSource === 'template' ? 'Standard price' : 'Price confirmed', tone: 'success', amount: money };
}

// ---- contact details (never part of a profile or task any more) ------------------

export async function myContact() {
  const { data, error } = await supabase.rpc('my_contact');
  if (error) return { phone: '', email: '' };
  const row = Array.isArray(data) ? data[0] : data;
  return { phone: row?.phone || '', email: row?.email || '' };
}

// Admins only, and every lookup is recorded by the database.
export async function adminContacts(ids) {
  const { data, error } = await supabase.rpc('admin_contacts', { p_ids: ids });
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((r) => [r.id, { phone: r.phone, email: r.email }]));
}

// ---- catalogue, bookings and multi-day changes -----------------------------------

// Published service families with their services. Empty until an admin publishes
// some (or on an older database): the booking screen then shows the classic categories.
export async function listCatalogue() {
  const { data, error } = await supabase.rpc('catalogue');
  return error || !Array.isArray(data) ? [] : data;
}

// One booking holding one or more tasks. `requestKey` stays the same across retries.
export async function createBooking(items, shared, requestKey) {
  const { data, error } = await supabase.rpc('create_booking', { p_items: items, p_shared: shared, p_request_key: requestKey || null });
  if (error) throw new Error(isMissingFeature(error) ? UPDATE_HINT : error.message);
  await refreshAll();
  return data;
}

export async function bookingSummary(bookingId) {
  const { data, error } = await supabase.rpc('booking_summary', { p_booking: bookingId });
  if (error) throw new Error(error.message);
  return data;
}

export async function listScopeChanges(taskId) {
  const { data, error } = await supabase.from('task_scope_changes').select('*').eq('task_id', taskId).order('created_at', { ascending: false });
  return error ? [] : data || [];
}
export const requestMultidayChange = (taskId, reason, visits, durationMinutes, priceImpact) =>
  rpc('request_multiday_change', { p_task: taskId, p_reason: reason, p_visits: visits, p_duration_minutes: durationMinutes || null, p_price_impact: priceImpact ?? null });
export const withdrawScopeChange = (changeId) => rpc('withdraw_scope_change', { p_change: changeId });
export const decideScopeChangeAdmin = (changeId, approve, note, priceImpact) =>
  rpc('decide_scope_change_admin', { p_change: changeId, p_approve: approve, p_note: note || null, p_price_impact: priceImpact ?? null });
export const decideScopeChangeCustomer = (changeId, approve) => rpc('decide_scope_change_customer', { p_change: changeId, p_approve: approve });

// ---- quotes, qualifications, assessments and the PM profile -------------------------

export async function listQuotes(taskId) {
  const { data, error } = await supabase.from('task_quotes').select('*').eq('task_id', taskId).order('version', { ascending: false });
  return error ? [] : data || [];
}
export const proposeQuote = (taskId, components, reason) => rpc('propose_quote', { p_task: taskId, p_components: components, p_reason: reason });
export const decideQuoteAdmin = (id, approve, note) => rpc('decide_quote_admin', { p_quote: id, p_approve: approve, p_note: note || null });
export const decideQuoteCustomer = (id, approve) => rpc('decide_quote_customer', { p_quote: id, p_approve: approve });

export async function listSkills() {
  const { data, error } = await supabase.from('skills').select('*').eq('active', true).order('name');
  return error ? [] : data || [];
}
export async function myQualifications(workerId) {
  const { data, error } = await supabase.from('pm_qualifications').select('*').eq('worker_id', workerId);
  return error ? [] : data || [];
}
export const claimSkill = (skill, note) => rpc('claim_skill', { p_skill: skill, p_note: note || null });
export async function availableAssessments() {
  const { data, error } = await supabase.rpc('available_assessments');
  return error ? [] : data || [];
}
export async function submitAssessment(id, answers) {
  const { data, error } = await supabase.rpc('submit_assessment', { p_assessment: id, p_answers: answers });
  if (error) throw new Error(error.message);
  await refreshAll();
  return data;
}
export async function pmPublicProfile(workerId) {
  const { data, error } = await supabase.rpc('pm_public_profile', { p_worker: workerId });
  if (error) throw new Error(error.message);
  return data;
}

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
    eligible: w.eligible !== false,                // older databases do not say: treat as eligible
    missingSkills: w.missing_skills || [],
    tier: w.tier || 'standard',
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

// The share is in basis points (8000 = 80%). A finished job uses the share recorded when it
// was completed; an offer or work in progress uses the PM's current rate.
export function pmShare(t) {
  const bps = t.pmShareBps ?? t.earnShareBps;
  return bps == null ? PM_SHARE : bps / 10000;
}

export function pmEarning(t) {
  return Math.round(runningTotal(t) * pmShare(t));
}

export function catMeta(id) {
  if (id === 'general') return { id, label: 'Something else', emoji: '✨' };
  return CATEGORIES.find((c) => c.id === id) || { label: id, emoji: '•' };
}

export function formatRating(r, count) {
  if (r == null) return 'New';
  return `★ ${Number(r).toFixed(1)}${count ? ` (${count})` : ''}`;
}
