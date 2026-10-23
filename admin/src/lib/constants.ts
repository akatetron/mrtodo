// Keep in sync with app/src/data/store.js and valid_categories() in supabase/schema.sql.
export const CATEGORIES = [
  { id: 'handyman', label: 'Handyman', emoji: '🔧' },
  { id: 'cleaning', label: 'Cleaning', emoji: '🧹' },
  { id: 'moving', label: 'Moving', emoji: '📦' },
  { id: 'delivery', label: 'Delivery', emoji: '🚴' },
  { id: 'care', label: 'Errands & Care', emoji: '💙' },
];

export const TASK_STATUS = {
  requested: { label: 'Needs a PM', tone: 'brass' },
  matched: { label: 'Offered — awaiting PM', tone: 'accent' },
  assigned: { label: 'Accepted', tone: 'accent' },
  in_progress: { label: 'In progress', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export const PM_STATUS = {
  draft: { label: 'Not submitted', tone: 'neutral' },
  pending: { label: 'Pending review', tone: 'brass' },
  more_info: { label: 'More info requested', tone: 'brass' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

export const PM_SHARE = 0.8;

export function catMeta(id) {
  return CATEGORIES.find((c) => c.id === id) || { label: id, emoji: '•' };
}

export function shortId(id) {
  return `MT-${String(id).slice(0, 6).toUpperCase()}`;
}

// The amount in its own currency. Amounts in different currencies are never added together.
export function money(n, currency = 'INR') {
  if (n == null) return '—';
  const whole = Number.isInteger(Number(n));
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : undefined }).format(Number(n));
  } catch (e) {
    return `${currency} ${Number(n).toLocaleString('en')}`;
  }
}

export function when(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function rating(r, n) {
  return r == null ? 'New' : `★ ${Number(r).toFixed(1)}${n ? ` (${n})` : ''}`;
}

// Profiles no longer expose phone or email; list columns explicitly (keep in sync with app/src/lib/errors.js).
export const PROFILE_COLUMNS = 'id, full_name, role, rating, rating_count, categories, jobs_done, distance_km, online, created_at, bio, experience_years, service_area, worker_status, application_note, applied_at, reviewed_at, reviewed_by, last_assigned_at, admin_level, tier, tier_since, verified_jobs, languages, base_lat, base_lng, deleted_at';
