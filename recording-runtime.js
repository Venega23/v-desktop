(function exposeRecordingRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SloyRecordingRuntime = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  function createLatestRequestGate(cancel = () => {}) {
    let generation = 0;
    let nextId = 0;
    let active = null;

    const matches = ticket => Boolean(ticket && active && ticket.id === active.id && ticket.generation === active.generation);
    return {
      begin(session, input = '') {
        if (active) cancel(active);
        active = { id:++nextId, generation, session, input:String(input || '') };
        return active;
      },
      invalidate() {
        const previous = active;
        generation += 1;
        active = null;
        if (previous) cancel(previous);
        return generation;
      },
      isCurrent(ticket, session = ticket?.session) {
        return matches(ticket) && ticket.session === session;
      },
      settle(ticket) {
        if (!matches(ticket)) return false;
        active = null;
        return true;
      },
      active() { return active; },
      generation() { return generation; }
    };
  }

  function withDeadline(value, timeoutMs, fallbackValue) {
    const delay = Math.max(1, Number(timeoutMs) || 1);
    let timer = null;
    return Promise.race([
      Promise.resolve(value),
      new Promise(resolve => { timer = setTimeout(() => resolve(fallbackValue), delay); })
    ]).finally(() => clearTimeout(timer));
  }

  function shouldRestartRecognition({ instance, current, session, currentSession, stopRequested = false, finishing = false } = {}) {
    return Boolean(instance && instance === current && session && session === currentSession && !stopRequested && !finishing);
  }

  function meetingFinishDecision({ hasMatchingSession = false, stopRequested = false, cardState = '' } = {}) {
    if (hasMatchingSession) return { latch:true, command:stopRequested ? 'wait' : 'stop' };
    if (cardState === 'active' || cardState === 'pausing') return { latch:false, command:'wait' };
    return { latch:false, command:'finalize' };
  }

  return { createLatestRequestGate, withDeadline, shouldRestartRecognition, meetingFinishDecision };
});
