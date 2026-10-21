import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep } from '../src/lib/nextStep.js';

const t = (o) => ({ status: 'requested', priceStatus: 'confirmed', reviewState: 'ready', ...o });
test('a finished or cancelled task has no next step', () => { assert.equal(nextStep(t({ status: 'completed' })), null); assert.equal(nextStep(t({ status: 'cancelled' })), null); });
test('a price waiting for the customer is an action', () => { const n = nextStep(t({ priceStatus: 'awaiting_confirmation' })); assert.equal(n.tone, 'action'); assert.match(n.title, /confirm the price/i); });
test('a question from the team is an action', () => assert.equal(nextStep(t({ reviewState: 'clarification_needed' })).tone, 'action'));
test('an unpriced general request says it is being reviewed and is not booked', () => { const n = nextStep(t({ priceStatus: 'awaiting_approval', reviewState: 'needs_review' })); assert.match(n.title, /reviewing/i); assert.match(n.body, /isn.t booked/i); });
test('an open priced request says it is finding a Personal Manager, with no time promise', () => { const n = nextStep(t({})); assert.match(n.title, /finding/i); assert.doesNotMatch(n.body, /minutes|soon|within/i); });
test('each real status has a plain-words step', () => { for (const status of ['matched', 'assigned', 'in_progress']) assert.ok(nextStep(t({ status })).title); });
