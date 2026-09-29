-- Mr. Todo — Supabase database schema
-- Run this once in your Supabase project's SQL Editor (Project → SQL Editor → New query → paste → Run).

-- 1. Profiles ---------------------------------------------------------------
-- One row per signed-up user, linked to Supabase's built-in auth.users table.
-- role: 'customer' | 'worker' | 'admin'
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null default 'customer' check (role in ('customer', 'worker', 'admin')),
  phone text,
  rating numeric(2,1) default 4.5,
  categories text[] default '{}',      -- for workers: which task categories they're qualified for
  jobs_done int default 0,
  distance_km numeric(4,1),
  online boolean default true,
  created_at timestamptz default now()
);

-- 2. Tasks --------------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id),
  assigned_worker_id uuid references profiles (id),
  title text not null,
  description text,
  category text not null,
  task_type text not null default 'one-time' check (task_type in ('one-time', 'ongoing')),
  status text not null default 'requested'
    check (status in ('requested', 'matched', 'assigned', 'in_progress', 'completed', 'cancelled')),
  scheduled_for text,
  location text not null,
  est_cost numeric(10,2),
  rate_per_day numeric(10,2),
  for_whom text default 'self' check (for_whom in ('self', 'other')),
  recipient_name text,
  recipient_relation text,
  recipient_phone text,
  otp text,                              -- 4-digit completion code, generated on creation
  customer_rating_of_worker numeric(2,1),  -- filled in after completion
  worker_rating_of_customer numeric(2,1),  -- filled in after completion
  created_at timestamptz default now()
);

-- 3. Visits (for multi-day / ongoing tasks) -----------------------------------
create table if not exists task_visits (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  note text,
  done boolean default true,
  created_at timestamptz default now()
);

-- 4. Row Level Security --------------------------------------------------------
alter table profiles enable row level security;
alter table tasks enable row level security;
alter table task_visits enable row level security;

-- Profiles: anyone signed in can read profiles (needed to show worker names/ratings);
-- a user can only edit their own profile.
create policy "profiles are readable by any signed-in user" on profiles
  for select using (auth.role() = 'authenticated');
create policy "users can update their own profile" on profiles
  for update using (auth.uid() = id);
create policy "users can insert their own profile" on profiles
  for insert with check (auth.uid() = id);

-- Tasks: a customer sees their own tasks; a worker sees tasks assigned to them
-- or unassigned tasks in their category (so they could see the "queue"); admins see everything.
create policy "customers see their own tasks" on tasks
  for select using (
    customer_id = auth.uid()
    or assigned_worker_id = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );
create policy "customers create their own tasks" on tasks
  for insert with check (customer_id = auth.uid());
create policy "customer, assigned worker, or admin can update a task" on tasks
  for update using (
    customer_id = auth.uid()
    or assigned_worker_id = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Visits: visible/writable by whoever can see the parent task.
create policy "visits follow task visibility" on task_visits
  for select using (
    exists (
      select 1 from tasks t where t.id = task_visits.task_id
      and (t.customer_id = auth.uid() or t.assigned_worker_id = auth.uid()
           or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
    )
  );
create policy "assigned worker or admin can log a visit" on task_visits
  for insert with check (
    exists (
      select 1 from tasks t where t.id = task_visits.task_id
      and (t.assigned_worker_id = auth.uid()
           or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
    )
  );

-- 5. Auto-create a profile row whenever someone signs up ----------------------
-- Reads the "full_name" and "role" you pass in signUp()'s options.data.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New user'),
    coalesce(new.raw_user_meta_data->>'role', 'customer')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 6. Realtime -------------------------------------------------------------------
-- Turns on live updates so a customer's tracking screen updates the instant
-- a worker logs a visit or completes a task, without refreshing.
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table task_visits;
