-- 0009 — a person can delete their account.
-- Safe to run more than once. Depends on 0001-0008.
--
-- What "delete" means here: the person's identity and private details are erased
-- at once (name, contact details, documents, skills, devices, notifications,
-- locations, a booked-for-someone-else recipient's details). Records the business
-- must keep for billing and disputes stay, but no longer name anyone: tasks,
-- prices, quotes, ratings, audit events, and task photos. The sign-in itself is
-- disabled by the delete-account Edge Function, which also removes the stored
-- documents. See docs/RETENTION.md.

alter table profiles add column if not exists deleted_at timestamptz;
select public.refresh_profile_grants();

-- Returns the storage paths of the person's documents so the Edge Function can remove the files.
create or replace function public.request_account_deletion()
returns text[] language plpgsql security definer set search_path = public as $$
declare me profiles; paths text[]; uid uuid := auth.uid();
begin
  select * into me from profiles where id = uid;
  if me.id is null then raise exception 'Sign in first.'; end if;
  if me.deleted_at is not null then raise exception 'This account has already been deleted.'; end if;
  if me.role = 'admin' then raise exception 'Admin accounts are removed by another super admin.'; end if;
  if exists (select 1 from tasks where (customer_id = uid or assigned_worker_id = uid) and status in ('requested', 'matched', 'assigned', 'in_progress')) then
    raise exception 'Finish or cancel your open tasks first.';
  end if;
  if exists (select 1 from subscriptions where customer_id = uid and status in ('pending', 'active', 'past_due')) then
    raise exception 'Cancel your Todo+ subscription first.';
  end if;
  if not rate_limit_self('delete_account', 3, 3600) then raise exception 'Please wait a little and try again.'; end if;

  select coalesce(array_agg(storage_path), '{}') into paths from pm_documents where worker_id = uid;
  delete from pm_documents where worker_id = uid;
  delete from pm_qualifications where worker_id = uid;
  delete from push_tokens where user_id = uid;
  delete from notifications where user_id = uid;
  delete from task_declines where worker_id = uid;
  delete from task_contacts where task_id in (select id from tasks where customer_id = uid);
  update tasks set recipient_name = null, recipient_relation = null, lat = null, lng = null where customer_id = uid;
  update bookings set recipient_name = null, recipient_relation = null, authorized_contact_name = null where customer_id = uid;
  update profiles set
    full_name = 'Deleted user', phone = null, email = 'deleted-' || uid || '@deleted.invalid',
    bio = null, service_area = null, languages = '{}', base_lat = null, base_lng = null,
    categories = '{}', online = false, experience_years = null, application_note = null,
    worker_status = case when role = 'worker' then 'suspended' else worker_status end,
    deleted_at = now()
   where id = uid;
  perform log_action('account.deleted', 'profile', uid, jsonb_build_object('role', me.role));
  return paths;
end $$;
revoke execute on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
