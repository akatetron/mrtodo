// Mr. Todo — data for the admin tools. Everything here is protected by the
// database, not by the app: a non-admin who somehow reached these calls gets
// empty results or an error from Postgres. The UI only hides what the database
// would refuse anyway.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isMissingFeature, UPDATE_HINT } from './extras';
import { PROFILE_COLUMNS } from '../lib/errors';

async function run(builder) {
  const { data, error } = await builder;
  if (error) throw new Error(isMissingFeature(error) ? UPDATE_HINT : error.message);
  return data;
}

export const adminLevel = (profile) => (profile?.role === 'admin' ? profile.admin_level || 'super' : null);
export const isSuperAdmin = (profile) => adminLevel(profile) === 'super';

// Loads once, then again whenever a row changes in `tables`, and whenever the
// screen is shown again. Keeps every admin list current without pull-to-refresh.
export function useLiveQuery(loader, tables, navigation) {
  const [state, setState] = useState({ data: null, error: '' });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const data = await loaderRef.current();
      if (alive.current) setState({ data, error: '' });
    } catch (e) {
      if (alive.current) setState((s) => ({ data: s.data, error: e.message || String(e) }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    let timer;
    const bump = () => { clearTimeout(timer); timer = setTimeout(reload, 200); };
    const channel = supabase.channel(`admin-${Math.random().toString(36).slice(2)}`);
    tables.forEach((table) => channel.on('postgres_changes', { event: '*', schema: 'public', table }, bump));
    channel.subscribe();
    const off = navigation?.addListener ? navigation.addListener('focus', reload) : null;
    return () => {
      alive.current = false; clearTimeout(timer); supabase.removeChannel(channel); if (off) off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, tables.join(',')]);

  return { ...state, reload };
}

// ---- applications & people -------------------------------------------------------------

export const listApplicants = () =>
  run(supabase.from('profiles').select(PROFILE_COLUMNS).eq('role', 'worker')
    .in('worker_status', ['pending', 'more_info', 'draft', 'rejected'])
    .order('applied_at', { ascending: true, nullsFirst: false }));

export const getProfile = (id) => run(supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).single());

export const listPeople = () =>
  run(supabase.from('profiles').select(PROFILE_COLUMNS).in('role', ['customer', 'worker']).order('full_name'));

export const listApprovedPms = () =>
  run(supabase.from('profiles').select(PROFILE_COLUMNS).eq('role', 'worker').eq('worker_status', 'approved'));

export const reviewApplication = (workerId, decision, note) =>
  run(supabase.rpc('review_pm_application', { p_worker: workerId, p_decision: decision, p_note: note || null }));

// Private ID/certificate files: short-lived links, readable by super admins only.
export async function listWorkerDocs(workerId) {
  const rows = await run(supabase.from('pm_documents').select('*').eq('worker_id', workerId).order('created_at'));
  return Promise.all(rows.map(async (d) => {
    const { data } = await supabase.storage.from('pm-documents').createSignedUrl(d.storage_path, 600);
    return { ...d, url: data?.signedUrl || null, isImage: /\.(png|jpe?g|webp|gif|heic)$/i.test(d.storage_path) };
  }));
}

// Certificates that have lapsed or lapse within `days`, with the PM's name.
export async function listExpiringDocs(days = 30) {
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return run(supabase.from('pm_documents')
    .select('*, worker:worker_id(id, full_name)').not('expires_on', 'is', null).lte('expires_on', until).order('expires_on'));
}

// How dependable each PM is. Quietly empty if the database update has not been run.
export async function pmReliability() {
  const { data, error } = await supabase.rpc('pm_reliability');
  if (error) return {};
  return Object.fromEntries((data || []).map((r) => [r.worker_id, r]));
}

// ---- admin team ----------------------------------------------------------------------------

export const listAdmins = () => run(supabase.from('profiles').select(PROFILE_COLUMNS).eq('role', 'admin').order('full_name'));
export const setAdminLevel = (userId, level) => run(supabase.rpc('set_admin_level', { p_user: userId, p_level: level }));

// ---- reports ------------------------------------------------------------------------------------

export const listReports = () =>
  run(supabase.from('reports')
    .select('*, task:task_id(id, title), reporter:reporter_id(full_name, role)')
    .order('created_at', { ascending: false }).limit(200));
export const resolveReport = (id, note) => run(supabase.rpc('resolve_report', { p_report: id, p_note: note }));

// ---- money ---------------------------------------------------------------------------------------

export const listPayouts = () => run(supabase.from('payouts').select('*').order('paid_at', { ascending: false }).limit(500));
export const recordPayout = (workerId, amount, note) =>
  run(supabase.rpc('record_payout', { p_worker: workerId, p_amount: amount, p_note: note || null }));

// ---- broadcast -------------------------------------------------------------------------------------

export const sendAnnouncement = (audience, title, body) =>
  run(supabase.rpc('send_announcement', { p_audience: audience, p_title: title, p_body: body || null }));

// ---- housekeeping -----------------------------------------------------------------------------------

// Puts unanswered offers back in the queue. Silent when the update has not been run.
export async function expireStaleOffers(minutes = 15) {
  const { data, error } = await supabase.rpc('expire_stale_offers', { p_minutes: minutes });
  return error ? 0 : data || 0;
}

// Numbers for the badges on the Tools menu.
export async function adminCounts() {
  const [apps, reports] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'worker').eq('worker_status', 'pending'),
    supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);
  return { applications: apps.error ? 0 : apps.count || 0, reports: reports.error ? 0 : reports.count || 0 };
}

// ---- calculations shared by Money, Insights and People ---------------------------------------------

export const DAY_MS = 86400000;

// Last comma-separated part of an address, e.g. "Flat 4B, Kandivali West" -> "Kandivali West".
export function areaOf(location) {
  const parts = String(location || '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'Unknown';
}

// ---- service catalogue (super admins edit; every admin can read) -------------------------

export async function listCatalogueAdmin() {
  const [families, services] = await Promise.all([
    run(supabase.from('service_families').select('*').order('sort_order')),
    run(supabase.from('catalogue_services').select('*').order('sort_order')),
  ]);
  return { families, services };
}
export const saveFamily = (f) => run(supabase.rpc('save_family', {
  p_key: f.key, p_name: f.name, p_description: f.description || null, p_icon: f.icon || null, p_sort: f.sort ?? null,
  p_status: f.status || 'draft', p_available: f.available !== false,
}));
export const saveServiceDraft = (key, familyId, category, definition) =>
  run(supabase.rpc('save_service_draft', { p_key: key, p_family: familyId, p_category: category, p_definition: definition }));
export const serviceReadiness = (id) => run(supabase.rpc('service_readiness', { p_service: id }));
export const publishService = (id) => run(supabase.rpc('publish_service', { p_service: id }));
export const setServiceStatus = (id, status) => run(supabase.rpc('set_service_status', { p_service: id, p_status: status }));
export const duplicateService = (id, newKey) => run(supabase.rpc('duplicate_service', { p_service: id, p_new_key: newKey }));

// ---- qualifications, interviews, assessments, specialists --------------------------------
export const setPmQualification = (worker, skill, status, level = 1, source = 'interview', expiresAt = null, note = null) =>
  run(supabase.rpc('set_pm_qualification', { p_worker: worker, p_skill: skill, p_status: status, p_level: level, p_source: source, p_expires_at: expiresAt, p_note: note }));
export const recordInterview = (worker, outcome, notes) => run(supabase.rpc('record_interview', { p_worker: worker, p_outcome: outcome, p_notes: notes || null }));
export const listInterviews = (worker) => run(supabase.from('pm_interviews').select('*').eq('worker_id', worker).order('created_at', { ascending: false }));
export const listAssessmentsAdmin = () => run(supabase.from('assessments').select('*').order('name'));
export const saveAssessment = (a) => run(supabase.rpc('save_assessment', {
  p_key: a.key, p_name: a.name, p_skill: a.skill, p_level: a.level || 1, p_questions: a.questions,
  p_pass_percent: a.passPercent || 80, p_validity_days: a.validityDays || null, p_active: !!a.active,
}));
export const listSpecialists = () => run(supabase.from('specialists').select('*').order('name'));
export const saveSpecialist = (s) => run(supabase.rpc('save_specialist', {
  p_id: s.id || null, p_name: s.name, p_skill: s.skill, p_verified: !!s.verified, p_note: s.note || null, p_phone: s.phone || null, p_active: s.active !== false,
}));
export const listSpecialistJobs = (taskId) => run(supabase.from('task_specialist_jobs').select('*, specialist:specialist_id(name, skill_key, verified)').eq('task_id', taskId).order('created_at'));
export const assignSpecialist = (task, specialist, note) => run(supabase.rpc('assign_specialist', { p_task: task, p_specialist: specialist, p_note: note || null }));
export const setSpecialistJob = (job, status, note) => run(supabase.rpc('set_specialist_job', { p_job: job, p_status: status, p_scheduled_at: null, p_note: note || null }));

// ---- escalations, plans, operations -------------------------------------------------------
export const listEscalations = () => run(supabase.from('escalations').select('*, task:task_id(id, title, location, scheduled_at, assigned_worker_id, status)').order('created_at', { ascending: false }).limit(100));
export const resolveEscalation = (id, resolution) => run(supabase.rpc('resolve_escalation', { p_escalation: id, p_resolution: resolution }));
export const unassignTask = (taskId, reason) => run(supabase.rpc('unassign_task', { p_task: taskId, p_reason: reason }));
export const listPlansAdmin = () => run(supabase.from('subscription_plans').select('*').order('name'));
export const savePlan = (p) => run(supabase.rpc('save_plan', {
  p_code: p.code, p_name: p.name, p_price: p.price === '' || p.price == null ? null : Number(p.price), p_visits: parseInt(p.visits, 10) || 1,
  p_categories: p.categories || [], p_description: p.description || null, p_terms: p.terms || null, p_provider_plan: p.providerPlan || null, p_active: !!p.active,
}));
export const listSubscriptionsAdmin = () => run(supabase.from('subscriptions').select('*, customer:customer_id(full_name)').order('created_at', { ascending: false }).limit(100));
export const opsSummary = () => run(supabase.rpc('ops_summary'));
export const goldOverview = () => run(supabase.rpc('gold_overview'));
export const listDeadOutbox = () => run(supabase.from('outbox').select('id, kind, last_error, attempts, created_at').eq('status', 'dead').order('created_at', { ascending: false }).limit(50));
