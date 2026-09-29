import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

let channelSeq = 0;

// Runs `load` and re-runs it whenever a row changes in any of `tables`
// (Supabase realtime), so every admin page stays current without refreshing.
export function useLive(load, tables, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError('');
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    reload();
    let timer;
    const channel = supabase.channel(`admin-live-${++channelSeq}`);
    tables.forEach((table) =>
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        clearTimeout(timer);
        timer = setTimeout(reload, 200);
      }));
    channel.subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, tables.join(','), ...deps]);

  return { data, error, reload };
}

// Throws on error so callers can show the database's message.
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}
