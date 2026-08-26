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
        generation: 0,
        holds: new Map(),
        childSessions: new Map(),
        childAutoAttach: false,
        lastDetachReason: null
      };
      states.set(tabId, state);
    }
    return state;
  }

  function cancelDetach(state) {
    if (!state.detachTimer) return;
    clearTimeout(state.detachTimer);
    state.detachTimer = null;
  }

  async function attach(state) {
    if (state.attached) return;
    cancelDetach(state);
    try {
      await chrome.debugger.attach({ tabId: state.tabId }, CDP_VERSION);
      state.attached = true;
      state.generation += 1;
      state.lastDetachReason = null;
    } catch (error) {
      throw new Error(`debugger_broker_attach_failed:${String(error?.message || error)}`);
    }
  }

  async function detachNow(state) {
    cancelDetach(state);
    if (!state.attached) return;
    state.attached = false;
    state.activeOwner = null;
    state.childAutoAttach = false;
    state.childSessions.clear();
    await chrome.debugger.detach({ tabId: state.tabId }).catch(() => {});
  }

  function canDetach(state, generation = state.generation) {
    return state.pending === 0 && !state.activeOwner && state.holds.size === 0 && generation === state.generation;
  }

  function scheduleDetach(state) {
    cancelDetach(state);
    const generation = state.generation;
    state.detachTimer = setTimeout(() => {
      state.detachTimer = null;
      if (!canDetach(state, generation)) return;
      detachNow(state).catch(() => {});
    }, IDLE_DETACH_MS);
  }

  function assertLeaseFresh(state, generation) {
    if (!state.attached || Number(generation) !== Number(state.generation)) throw new Error("debugger_broker_lease_stale");
  }

  async function send(state, generation, method, params = {}, sessionId = null) {
    assertLeaseFresh(state, generation);
    const target = sessionId ? { tabId: state.tabId, sessionId: String(sessionId) } : { tabId: state.tabId };
    return chrome.debugger.sendCommand(target, method, params);
  }

  function childList(state) {
    return [...state.childSessions.values()].map((child) => ({ ...child }));
  }

  async function enableChildTargets(state, generation) {
    assertLeaseFresh(state, generation);
    if (state.childAutoAttach) return childList(state);
    state.childAutoAttach = true;
    await send(state, generation, "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: "iframe", exclude: false }]
    });
    return childList(state);
  }

  async function disableChildTargets(state, generation) {
    assertLeaseFresh(state, generation);
    if (!state.childAutoAttach) {
      state.childSessions.clear();
      return;
    }
    try {
      await send(state, generation, "Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true
      });
    } finally {
      state.childAutoAttach = false;
      state.childSessions.clear();
    }
  }

  function sessionFor(state, ownerName, generation) {
    return Object.freeze({
      tabId: state.tabId,
      owner: ownerName,
      generation,
      send: (method, params = {}) => send(state, generation, method, params),
      sendChild: (sessionId, method, params = {}) => send(state, generation, method, params, sessionId),
      childSessions: () => childList(state),
      enableChildTargets: () => enableChildTargets(state, generation),
      disableChildTargets: () => disableChildTargets(state, generation)
    });
  }

  function enqueue(state, ownerName, operation) {
    state.pending += 1;
    cancelDetach(state);
    const task = state.queue.then(async () => {
      await attach(state);
      const generation = state.generation;
      state.activeOwner = ownerName;
      try {
        return await operation(sessionFor(state, ownerName, generation));
      } finally {
        if (state.activeOwner === ownerName) state.activeOwner = null;
      }
    });
    state.queue = task.catch(() => {}).finally(() => {
      state.pending = Math.max(0, state.pending - 1);
      if (canDetach(state)) scheduleDetach(state);
    });
    return task;
  }

  function run(tabId, owner, operation) {
    if (!Number.isInteger(Number(tabId))) return Promise.reject(new Error("debugger_broker_tab_invalid"));
    if (typeof operation !== "function") return Promise.reject(new Error("debugger_broker_operation_invalid"));
    const state = stateFor(Number(tabId));
    const ownerName = String(owner || "anonymous").slice(0, 96);
    return enqueue(state, ownerName, operation);
  }

  function hold(tabId, owner) {
    if (!Number.isInteger(Number(tabId))) return Promise.reject(new Error("debugger_broker_tab_invalid"));
    const state = stateFor(Number(tabId));
    const ownerName = String(owner || "anonymous-hold").slice(0, 96);
    return enqueue(state, `hold:${ownerName}`, async (session) => {
      const token = crypto.randomUUID();
      const generation = session.generation;
      state.holds.set(token, { token, owner: ownerName, generation, acquired_at: new Date().toISOString() });
      let released = false;
      return Object.freeze({
        tabId: state.tabId,
        owner: ownerName,
        generation,
        send: (method, params = {}) => send(state, generation, method, params),
        sendChild: (sessionId, method, params = {}) => send(state, generation, method, params, sessionId),
        childSessions: () => childList(state),
        enableChildTargets: () => enableChildTargets(state, generation),
        disableChildTargets: () => disableChildTargets(state, generation),
        release: async () => {
          if (released) return;
          released = true;
          state.holds.delete(token);
          if (canDetach(state)) scheduleDetach(state);
        }
      });
    });
  }

  async function close(tabId) {
    const state = states.get(Number(tabId));
    if (!state) return;
    await state.queue.catch(() => {});
    state.holds.clear();
    await detachNow(state);
    states.delete(Number(tabId));
  }

  function status() {
    return [...states.values()].map((state) => ({
      tab_id: state.tabId,
      attached: state.attached,
      pending: state.pending,
      active_owner: state.activeOwner,
      hold_count: state.holds.size,
      hold_owners: [...state.holds.values()].map((holdRow) => holdRow.owner),
      child_session_count: state.childSessions.size,
      child_auto_attach: state.childAutoAttach,
      generation: state.generation,
      last_detach_reason: state.lastDetachReason
    }));
  }

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = Number(source?.tabId);
    if (!Number.isInteger(tabId)) return;
    const state = states.get(tabId);
    if (!state || !state.attached) return;

    if (method === "Target.attachedToTarget" && params?.sessionId) {
      const sessionId = String(params.sessionId);
      const targetInfo = params.targetInfo || {};
      state.childSessions.set(sessionId, {
        session_id: sessionId,
        target_id: targetInfo.targetId || null,
        type: targetInfo.type || null,
        url: targetInfo.url || null,
        parent_session_id: source?.sessionId || null,
        waiting_for_debugger: params.waitingForDebugger === true
      });
      if (state.childAutoAttach && targetInfo.type === "iframe") {
        const childTarget = { tabId, sessionId };
        chrome.debugger.sendCommand(childTarget, "Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
          filter: [{ type: "iframe", exclude: false }]
        }).catch(() => {});
      }
      return;
    }

    if (method === "Target.detachedFromTarget" && params?.sessionId) state.childSessions.delete(String(params.sessionId));
  });

  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = Number(source?.tabId);
    if (!Number.isInteger(tabId)) return;
    const state = states.get(tabId);
    if (!state) return;
    state.attached = false;
    state.activeOwner = null;
    state.childAutoAttach = false;
    state.childSessions.clear();
    state.holds.clear();
    state.generation += 1;
    state.lastDetachReason = String(reason || "unknown");
    cancelDetach(state);
    chrome.storage.local.set({
      operatorDebuggerLastDetach: state.lastDetachReason,
      operatorDebuggerLastDetachTabId: tabId,
      operatorDebuggerLastDetachAt: new Date().toISOString()
    }).catch(() => {});
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    const state = states.get(Number(tabId));
    if (!state) return;
    cancelDetach(state);
    state.holds.clear();
    states.delete(Number(tabId));
  });

  globalThis.A2_DEBUGGER_RUN = run;
  globalThis.A2_DEBUGGER_HOLD = hold;
  globalThis.A2_DEBUGGER_CLOSE = close;
  globalThis.A2_DEBUGGER_STATUS = status;
})();
