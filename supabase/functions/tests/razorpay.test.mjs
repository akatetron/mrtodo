// Run:  node --experimental-strip-types --test supabase/functions/tests/razorpay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySignature, parseEvent } from '../_shared/razorpay.ts';

const secret = 'whsec_test';
const body = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1', current_start: 1760000000, current_end: 1762600000 } } } });
const sign = (b, s = secret) => createHmac('sha256', s).update(b).digest('hex');

test('a correct signature is accepted', () => assert.equal(verifySignature(body, sign(body), secret), true));
test('a wrong secret is rejected', () => assert.equal(verifySignature(body, sign(body, 'other'), secret), false));
test('a tampered body is rejected', () => assert.equal(verifySignature(body.replace('sub_1', 'sub_2'), sign(body), secret), false));
test('a missing signature is rejected', () => assert.equal(verifySignature(body, null, secret), false));
test('an empty secret never validates', () => assert.equal(verifySignature(body, sign(body, ''), ''), false));
test('a signature of the wrong length is rejected without throwing', () => assert.equal(verifySignature(body, 'abc', secret), false));
test('the event id, type, subscription and period are extracted', () => {
  const ev = parseEvent('evt_9', JSON.parse(body));
  assert.deepEqual(ev, { eventId: 'evt_9', type: 'subscription.charged', providerSubscription: 'sub_1',
    periodStart: new Date(1760000000 * 1000).toISOString(), periodEnd: new Date(1762600000 * 1000).toISOString() });
});
test('a payment event finds its subscription through the payment', () => {
  const ev = parseEvent('evt_10', { event: 'payment.failed', payload: { payment: { entity: { subscription_id: 'sub_7' } } } });
  assert.equal(ev.providerSubscription, 'sub_7'); assert.equal(ev.periodStart, null);
});
test('an event without an id is ignored', () => assert.equal(parseEvent(null, { event: 'x' }), null));
test('a body without an event type is ignored', () => assert.equal(parseEvent('evt', { nope: 1 }), null));
