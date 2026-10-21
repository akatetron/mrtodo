// What happens next, from the task's real state. Pure, so it can be tested without a phone.
// Only states the backend actually has are described: no tracking, ETA or availability claims.
export function nextStep(t) {
  if (!t || ['completed', 'cancelled'].includes(t.status)) return null;
  if (t.priceStatus === 'awaiting_confirmation') return { icon: 'check', tone: 'action', title: 'Action needed: confirm the price', body: 'We’ve set a price for your request. Nothing starts until you confirm it below.' };
  if (t.reviewState === 'clarification_needed') return { icon: 'message-circle', tone: 'action', title: 'Action needed: we have a question', body: 'Open your notifications to see what we need to know.' };
  if (['requested', 'matched'].includes(t.status) && (t.reviewState === 'needs_review' || t.priceStatus === 'awaiting_approval')) {
    return { icon: 'clipboard', tone: 'info', title: 'We’re reviewing your request', body: 'This isn’t booked yet. We’ll set a price for you to confirm, or ask for anything we’re missing.' };
  }
  if (t.status === 'requested') return { icon: 'search', tone: 'info', title: 'Finding a Personal Manager', body: 'Your request is open. You’ll be notified when someone accepts it.' };
  if (t.status === 'matched') return { icon: 'clock', tone: 'info', title: 'Waiting for a Personal Manager to confirm', body: 'Your task has been offered to a Personal Manager. They need to accept it first.' };
  if (t.status === 'assigned') return { icon: 'calendar', tone: 'info', title: 'A Personal Manager has accepted', body: t.scheduledAt || t.scheduledFor ? 'They will arrive at the time you chose.' : 'They’ll be in touch to agree a time.' };
  if (t.status === 'in_progress') return { icon: 'tool', tone: 'info', title: 'Work is under way', body: 'When it’s done, show your completion code to your Personal Manager.' };
  return null;
}

