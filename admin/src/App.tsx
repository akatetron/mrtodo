import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { PROFILE_COLUMNS } from './lib/constants';
import { useLive, q } from './lib/useLive';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Tasks from './pages/Tasks';
import Applications from './pages/Applications';
import PersonalManagers from './pages/PersonalManagers';
import AuditLog from './pages/AuditLog';
import Escalations from './pages/Escalations';
import Operations from './pages/Operations';
import Catalogue from './pages/Catalogue';
import Plans from './pages/Plans';
import Standards from './pages/Standards';
import Regions from './pages/Regions';
import Pricing from './pages/Pricing';
import Assignment from './pages/Assignment';

const PAGES = [
  { id: 'overview', label: 'Overview', component: Overview },
  { id: 'tasks', label: 'Task queue', component: Tasks },
  { id: 'escalations', label: 'Escalations', component: Escalations },
  { id: 'catalogue', label: 'Service catalogue', component: Catalogue },
  { id: 'standards', label: 'Standards', component: Standards },
  { id: 'regions', label: 'Regions and hours', component: Regions },
  { id: 'pricing', label: 'Pricing rules', component: Pricing },
  { id: 'assignment', label: 'Assignment', component: Assignment },
  { id: 'plans', label: 'Todo+ plans', component: Plans },
  { id: 'applications', label: 'Applications', component: Applications },
  { id: 'pms', label: 'Personal Managers', component: PersonalManagers },
  { id: 'ops', label: 'Operations', component: Operations },
  { id: 'audit', label: 'Audit log', component: AuditLog },
];

function pageFromHash() {
  const id = window.location.hash.replace('#', '').split('/')[0];
  return PAGES.some((p) => p.id === id) ? id : 'overview';
}

export default function App() {
  const [session, setSession] = useState<any>(undefined);
  const [profile, setProfile] = useState<any>(null);
  const [denied, setDenied] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  useEffect(() => {
    setProfile(null);
    if (!userId) return;
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single().then(({ data }) => {
      if (data?.role === 'admin') { setProfile(data); setDenied(''); return; }
      setDenied('This account is not an admin. Ask an existing admin to promote it (see SETUP_BACKEND.md).');
      supabase.auth.signOut();
    });
  }, [userId]);

  if (session === undefined || (session && !profile)) {
    return <div className="login"><div className="card muted">Loading…</div></div>;
  }
  if (!session) return <Login notice={denied} />;
  return <Shell profile={profile} />;
}

function Shell({ profile }) {
  const [page, setPage] = useState(pageFromHash);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (id: string, sub?: string) => { window.location.hash = sub ? `${id}/${sub}` : id; };

  const { data: counts } = useLive(async () => {
    const [queue, apps] = await Promise.all([
      q(supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'requested').then((r) => ({ data: r.count, error: r.error }))),
      q(supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'worker').eq('worker_status', 'pending').then((r) => ({ data: r.count, error: r.error }))),
    ]);
    return { tasks: queue, applications: apps };
  }, ['tasks', 'profiles']);

  const Page: any = PAGES.find((p) => p.id === page)!.component;
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Mr. Todo<small>Admin</small></div>
        {PAGES.map((p) => (
          <button key={p.id} aria-current={page === p.id ? 'page' : undefined} className={`nav-btn ${page === p.id ? 'active' : ''}`} onClick={() => go(p.id)}>
            {p.label}
            {!!counts?.[p.id] && <span className="nav-count">{counts[p.id]}</span>}
          </button>
        ))}
        <div className="sidebar-foot">
          Signed in as<br /><strong style={{ color: '#fff' }}>{profile.full_name}</strong>
          <br />
          <button className="btn ghost sm" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </nav>
      <main className="main" id="main" tabIndex={-1}>
        <Page go={go} profile={profile} />
      </main>
    </div>
  );
}
