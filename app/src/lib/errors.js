// Shared by the data layers. Kept in its own file so data/store.js and
// data/extras.js can both use it without importing each other.

// PostgREST says "relation/function does not exist" with these codes/messages.
// It is how the app notices that the database has not been updated yet.
export function isMissingFeature(error) {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''}`;
  return /PGRST20[0-9]|42P01|42883|does not exist|could not find the (table|function)|schema cache/i.test(text);
}

export const UPDATE_HINT = 'This part needs the latest database update. Run the newest supabase/schema.sql in your Supabase SQL Editor.';

// The profile columns an app may read. phone and email are deliberately absent:
// the database does not allow them (use my_contact() for your own, and the
// admin tools for anyone else's).
export const PROFILE_COLUMNS = [
  'id', 'full_name', 'role', 'rating', 'rating_count', 'categories', 'jobs_done', 'distance_km', 'online',
  'created_at', 'bio', 'experience_years', 'service_area', 'worker_status', 'application_note', 'applied_at',
  'reviewed_at', 'reviewed_by', 'last_assigned_at', 'admin_level', 'tier', 'tier_since', 'verified_jobs',
  'languages', 'base_lat', 'base_lng', 'deleted_at',
].join(', ');
