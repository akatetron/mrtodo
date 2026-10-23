// Offers, availability, vehicles and the gender-for-matching setting. Every rule lives in the database.
import { supabase } from '../lib/supabase';

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function listMyOffers() {
  const { data, error } = await supabase.rpc('my_offers');
  return error ? [] : data || [];          // an older database has no offers: nothing to show
}
export const respondToOffer = (offerId, accept, note) => call('respond_offer', { p_offer: offerId, p_accept: accept, p_note: note || null });

export const mySchedule = () => call('my_schedule', { p_worker: null });
export const saveWorkingHours = (rows) => call('set_working_hours', { p_worker: null, p_rows: rows });
export const addTimeOff = (start, end, note) => call('add_pm_block_local', { p_worker: null, p_start: start, p_end: end, p_kind: 'time_off', p_note: note || null });
export const removeTimeOff = (id) => call('remove_pm_block', { p_id: id });
export const saveVehicles = (vehicles, travel) => call('set_pm_vehicles', { p_worker: null, p_vehicles: vehicles, p_travel: travel });
export const saveRegions = (codes) => call('set_pm_regions', { p_worker: null, p_regions: codes });

export async function genderMatchingActive() {
  const { data, error } = await supabase.rpc('gender_matching_active');
  return error ? false : !!data;
}
export async function myGenderStatus() {
  const { data, error } = await supabase.rpc('my_gender_status');
  return error ? { gender: null, consented: false } : data || { gender: null, consented: false };
}
export const saveGender = (gender, consent) => call('set_my_gender', { p_gender: gender, p_consent: consent });
