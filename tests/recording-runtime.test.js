const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createLatestRequestGate,
  withDeadline,
  shouldRestartRecognition,
  meetingFinishDecision
} = require('../recording-runtime');

test('latest request owns success and stale finally cannot clear it', () => {
  const cancelled = [];
  const gate = createLatestRequestGate(ticket => cancelled.push(ticket.id));
  const session = {};
  const first = gate.begin(session, 'A');
  const second = gate.begin(session, 'B');
  assert.deepEqual(cancelled, [first.id]);
  assert.equal(gate.isCurrent(first, session), false);
  assert.equal(gate.settle(first), false);
  assert.equal(gate.isCurrent(second, session), true);
  assert.equal(gate.settle(second), true);
});

test('stop and restart invalidate old session without touching the new request', () => {
  const gate = createLatestRequestGate();
  const firstSession = {};
  const old = gate.begin(firstSession, 'old');
  gate.invalidate();
  const secondSession = {};
  const current = gate.begin(secondSession, 'new');
  assert.equal(gate.isCurrent(old, firstSession), false);
  assert.equal(gate.settle(old), false);
  assert.equal(gate.isCurrent(current, secondSession), true);
});

test('deadline settles a provider stop that never resolves', async () => {
  const started = Date.now();
  const result = await withDeadline(new Promise(() => {}), 20, 'timed-out');
  assert.equal(result, 'timed-out');
  assert.ok(Date.now() - started < 500);
});

test('speech recognition restarts only for the current active session and instance', () => {
  const instance = {};
  const session = { stopRequested:false };
  assert.equal(shouldRestartRecognition({ instance, current:instance, session, currentSession:session }), true);
  assert.equal(shouldRestartRecognition({ instance, current:{}, session, currentSession:session }), false);
  assert.equal(shouldRestartRecognition({ instance, current:instance, session, currentSession:{}, stopRequested:false }), false);
  assert.equal(shouldRestartRecognition({ instance, current:instance, session, currentSession:session, stopRequested:true }), false);
  assert.equal(shouldRestartRecognition({ instance, current:instance, session, currentSession:session, finishing:true }), false);
});

test('finish while pausing latches finalization instead of finalizing too early', () => {
  assert.deepEqual(meetingFinishDecision({ hasMatchingSession:true, stopRequested:false, cardState:'active' }), { latch:true, command:'stop' });
  assert.deepEqual(meetingFinishDecision({ hasMatchingSession:true, stopRequested:true, cardState:'pausing' }), { latch:true, command:'wait' });
  assert.deepEqual(meetingFinishDecision({ hasMatchingSession:false, cardState:'paused' }), { latch:false, command:'finalize' });
  assert.deepEqual(meetingFinishDecision({ hasMatchingSession:false, cardState:'pausing' }), { latch:false, command:'wait' });
});
