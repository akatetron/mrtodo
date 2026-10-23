// The booking in progress: tasks already added, plus the details shared by all of
// them (place, who it is for). It lives here so moving between the discover,
// category and booking screens never loses what the customer typed.
import { useSyncExternalStore } from 'react';
import { newRequestId } from './store';

const blank = () => ({
  cart: [],                 // tasks already added to this booking
  location: '', point: null, region: null,
  forWhom: 'self', recipientName: '', recipientRelation: '', recipientPhone: '',
  consent: false, shareUpdates: false, contactName: '',
  requestKey: newRequestId(),   // the same across retries, so a retry cannot book twice
});

let draft = blank();
const listeners = new Set();
const emit = () => { draft = { ...draft }; listeners.forEach((l) => l()); };

export const getDraft = () => draft;
export function patchDraft(patch) { Object.assign(draft, patch); emit(); }
export function addToCart(item) { draft.cart = [...draft.cart, item]; emit(); }
export function removeFromCart(i) { draft.cart = draft.cart.filter((_, j) => j !== i); emit(); }
export function resetDraft() { draft = blank(); listeners.forEach((l) => l()); }

export function useBookingDraft() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => draft, () => draft);
}
