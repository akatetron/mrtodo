-- Shared helpers for the behaviour suites. Include with:  \i helpers.sql
-- (the runner starts psql inside supabase/tests/, so the path is relative).
--
--   :as_C ;   act as the customer      :as_C2 ;  a second customer
--   :as_P ;   act as an approved PM    :as_Q ;   a second approved PM
--   :as_AD ;  act as a super admin     :as_SU ;  act as a support admin
--   :as_anon ;  signed out             :as_db ;  back to the database owner
--
--   select chk(<condition>, 'what must be true');
--   select expect_error($$<statement>$$, 'what must be refused');
\set ON_ERROR_STOP 1

\set U_C  '00000000-0000-0000-0000-0000000000c1'
\set U_C2 '00000000-0000-0000-0000-0000000000c2'
\set U_P  '00000000-0000-0000-0000-0000000000a1'
\set U_Q  '00000000-0000-0000-0000-0000000000a2'
\set U_AD '00000000-0000-0000-0000-0000000000ad'
\set U_SU '00000000-0000-0000-0000-0000000000a5'

\set as_C   'reset role; select set_config(''request.jwt.claims'', ''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'', false); set role authenticated'
\set as_C2  'reset role; select set_config(''request.jwt.claims'', ''{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}'', false); set role authenticated'
\set as_P   'reset role; select set_config(''request.jwt.claims'', ''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'', false); set role authenticated'
\set as_Q   'reset role; select set_config(''request.jwt.claims'', ''{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}'', false); set role authenticated'
\set as_AD  'reset role; select set_config(''request.jwt.claims'', ''{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}'', false); set role authenticated'
\set as_SU  'reset role; select set_config(''request.jwt.claims'', ''{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}'', false); set role authenticated'
\set as_anon 'reset role; select set_config(''request.jwt.claims'', ''{"role":"anon"}'', false); set role anon'
\set as_db  'reset role'

create function public.expect_error(q text, label text) returns text language plpgsql as $$
begin execute q; raise exception 'FAIL (no error): %', label;
exception when others then
  if sqlerrm like 'FAIL (no error)%' then raise; end if;
  return 'ok  ' || label || '  -> ' || sqlerrm; end $$;
grant execute on function public.expect_error(text, text) to authenticated, anon;

create function public.chk(cond boolean, label text) returns text language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAIL: %', label; end if; return 'ok  ' || label; end $$;
grant execute on function public.chk(boolean, text) to authenticated, anon;

-- The five people most suites need. Profiles are created by the signup trigger,
-- then made what the tests need by the database owner (as an operator would).
create function public.seed_people() returns void language plpgsql as $$
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-0000-0000-0000000000c1', 'c@x',  '{"full_name":"Priya","phone":"98200 11111"}'),
    ('00000000-0000-0000-0000-0000000000c2', 'c2@x', '{"full_name":"Other Customer","phone":"98200 99999"}'),
    ('00000000-0000-0000-0000-0000000000a1', 'p@x',  '{"full_name":"Rakesh","role":"worker","phone":"98200 22222"}'),
    ('00000000-0000-0000-0000-0000000000a2', 'q@x',  '{"full_name":"Suresh","role":"worker","phone":"98200 33333"}'),
    ('00000000-0000-0000-0000-0000000000ad', 'ad@x', '{"full_name":"Admin","phone":"98200 00000"}'),
    ('00000000-0000-0000-0000-0000000000a5', 'su@x', '{"full_name":"Support","phone":"98200 00001"}')
  on conflict do nothing;
  update profiles set role = 'admin' where email = 'ad@x';
  update profiles set role = 'admin', admin_level = 'support' where email = 'su@x';
  update profiles set worker_status = 'approved', categories = array['handyman', 'cleaning'], service_area = 'Kandivali'
   where email in ('p@x', 'q@x');
end $$;
