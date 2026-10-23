// Regions, price estimates and time slots. The server decides all of it; this file only asks.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

let regionCache = null;
const listeners = new Set();

export async function loadRegions(force) {
  if (regionCache && !force) return regionCache;
  const { data, error } = await supabase.from('regions').select('code, name, currency, timezone').eq('status', 'active').order('name');
  regionCache = error ? [] : data || [];      // an older database has no regions: bookings work as before
  listeners.forEach((l) => l(regionCache));
  return regionCache;
}

export function useRegions() {
  const [regions, setRegions] = useState(regionCache || []);
  const [loaded, setLoaded] = useState(!!regionCache);
  useEffect(() => {
    const l = (r) => setRegions(r);
    listeners.add(l);
    loadRegions().then((r) => { setRegions(r); setLoaded(true); });
    return () => listeners.delete(l);
  }, []);
  return { regions, loaded };
}

export async function fetchEstimate({ serviceId, region, minutes, quantity }) {
  const { data, error } = await supabase.rpc('price_estimate', { p_service: serviceId, p_region: region || null, p_minutes: minutes || null, p_qty: quantity || 1 });
  if (error) return { available: false, status: 'unavailable', reason: 'error', message: 'We could not work out an estimate just now. You can still send your request and we will price it.' };
  return data;
}

export async function fetchSlots({ region, date, minutes }) {
  const { data, error } = await supabase.rpc('available_slots', { p_region: region, p_date: date, p_minutes: minutes || null, p_step: 30 });
  return error ? [] : data || [];
}

export function useEstimate(serviceId, region, minutes, quantity) {
  const [state, setState] = useState({ estimate: null, loading: false });
  useEffect(() => {
    if (!serviceId || !region) { setState({ estimate: null, loading: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      const est = await fetchEstimate({ serviceId, region, minutes, quantity });
      if (live) setState({ estimate: est, loading: false });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [serviceId, region, minutes, quantity]);
  return state;
}
