(() => {
  "use strict";

  const CDP_VERSION = "1.3";
  const IDLE_DETACH_MS = 1200;
  const states = new Map();

  function stateFor(tabId) {
    let state = states.get(tabId);
    if (!state) {
      state = {
        tabId,
        attached: false,
        queue: Promise.resolve(),
        pending: 0,
        activeOwner: null,
        detachTimer: null,
        generation: 0
      };
      states.set(tabId, state);
    }
    return state;
  }

  async function attach(state) {
    if (state.attached) return;
    try {
      await chrome.debugger.attach({ tabId: state.tabId }, CDP_VERSION);
      state.attached = true;
      state.generation += 1;
    } catch (error) {
      throw new Error(`debugger_broker_attach_failed:${String(error?.message || error)}`);
    }
  }

  async function detachNow(state) {
    if (state.detachTimer) {
      clearTimeout(state.detachTimer);
      state.detachTimer = null;
    }
    if (!state.attached) return;
    state.attached = false;
    state.activeOwner = null;
    await chrome.debugger.detach({ tabId: state.tabId }).catch(() => {});
  }

  function scheduleDetach(state) {
    if (state.detachTimer) clearTimeout(state.detachTimer);
    const generation = state.generation;
    state.detachTimer = setTimeout(() => {
      state.detachTimer = null;
      if (state.pending !== 0 || state.activeOwner || generation !== state.generation) return;
      detachNow(state).catch(() => {});
    }, IDLE_DETACH_MS);
  }

  async function send(state, method, params = {}) {
    if (!state.attached) throw new Error("debugger_broker_not_attached");
    return chrome.debugger.sendCommand({ tabId: state.tabId }, method, params);
  }

  function run(tabId, owner, operation) {
    if (!Number.isInteger(Number(tabId))) return Promise.reject(new Error("debugger_broker_tab_invalid"));
    if (typeof operation !== "function") return Promise.reject(new Error("debugger_broker_operation_invalid"));
    const state = stateFor(Number(tabId));
    const ownerName = String(owner || "anonymous").slice(0, 96);
    state.pending += 1;
    if (state.detachTimer) {
      clearTimeout(state.detachTimer);
      state.detachTimer = null;
    }

    const task = state.queue.then(async () => {
      await attach(state);
      state.activeOwner = ownerName;
      const session = Object.freeze({
        tabId: state.tabId,
        owner: ownerName,
        generation: state.generation,
        send: (method, params = {}) => send(state, method, params)
      });
      try {
        return await operation(session);
      } finally {
        state.activeOwner = null;
      }
    });

    state.queue = task.catch(() => {}).finally(() => {
      state.pending = Math.max(0, state.pending - 1);
      if (state.pending === 0 && !state.activeOwner) scheduleDetach(state);
    });
    return task;
  }

  async function close(tabId) {
    const state = states.get(Number(tabId));
    if (!state) return;
    await state.queue.catch(() => {});
    await detachNow(state);
    states.delete(Number(tabId));
  }

  function status() {
    return [...states.values()].map((state) => ({
      tab_id: state.tabId,
      attached: state.attached,
      pending: state.pending,
      active_owner: state.activeOwner,
      generation: state.generation
    }));
  }

  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = Number(source?.tabId);
    if (!Number.isInteger(tabId)) return;
    const state = states.get(tabId);
    if (!state) return;
    state.attached = false;
    state.activeOwner = null;
    state.generation += 1;
    if (state.detachTimer) {
      clearTimeout(state.detachTimer);
      state.detachTimer = null;
    }
    chrome.storage.local.set({
      operatorDebuggerLastDetach: String(reason || "unknown"),
      operatorDebuggerLastDetachTabId: tabId,
      operatorDebuggerLastDetachAt: new Date().toISOString()
    }).catch(() => {});
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    const state = states.get(Number(tabId));
    if (!state) return;
    if (state.detachTimer) clearTimeout(state.detachTimer);
    states.delete(Number(tabId));
  });

  globalThis.A2_DEBUGGER_RUN = run;
  globalThis.A2_DEBUGGER_CLOSE = close;
  globalThis.A2_DEBUGGER_STATUS = status;
})();
