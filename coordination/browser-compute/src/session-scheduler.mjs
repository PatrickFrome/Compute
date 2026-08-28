function assertNonempty(value, code) {
  if (typeof value !== 'string' || !value) throw new Error(code);
  return value;
}

function assertEpoch(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('conversation_epoch_invalid');
  return value;
}

function staleError() { return new Error('snapshot_stale'); }

export class CdpSessionScheduler {
  #client;
  #processIncarnationId;
  #maxInFlight;
  #inFlight = 0;
  #waiters = [];
  #bindings = new Map();
  #sessionTargets = new Map();
  #detachedSessions = new Set();
  #targetTails = new Map();
  #generation = 0;
  #lifecycleRevision = 0;
  #unsubscribers = [];
  #disposed = false;
  #onTargetInvalidated;
  #onDisposed;

  constructor({ client, processIncarnationId, maxInFlight = 4, onTargetInvalidated = null, onDisposed = null } = {}) {
    if (!client || typeof client.call !== 'function' || typeof client.on !== 'function' || typeof client.rejectSession !== 'function') {
      throw new Error('cdp_session_client_invalid');
    }
    this.#client = client;
    this.#processIncarnationId = assertNonempty(processIncarnationId, 'process_incarnation_id_invalid');
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 32) throw new Error('session_max_inflight_invalid');
    this.#maxInFlight = maxInFlight;
    if (onTargetInvalidated != null && typeof onTargetInvalidated !== 'function') throw new Error('session_invalidation_handler_invalid');
    if (onDisposed != null && typeof onDisposed !== 'function') throw new Error('session_dispose_handler_invalid');
    this.#onTargetInvalidated = onTargetInvalidated;
    this.#onDisposed = onDisposed;
    this.#unsubscribers.push(
      client.on('Target.detachedFromTarget', (params) => this.#onDetached(params)),
      client.on('Target.targetCrashed', (params) => this.#invalidateEngineTarget(params?.targetId, 'target_crashed')),
      client.on('Target.targetDestroyed', (params) => this.#invalidateEngineTarget(params?.targetId, 'target_destroyed'))
    );
    if (typeof client.onClose === 'function') {
      this.#unsubscribers.push(client.onClose(() => this.dispose('cdp_transport_closed')));
    }
  }

  get processIncarnationId() { return this.#processIncarnationId; }
  get activeBindingCount() { return this.#bindings.size; }
  get inFlightCount() { return this.#inFlight; }

  #identity(input) {
    const identity = {
      targetId: assertNonempty(input?.targetId, 'target_id_invalid'),
      cdpTargetId: assertNonempty(input?.cdpTargetId, 'cdp_target_id_invalid'),
      conversationEpoch: assertEpoch(input?.conversationEpoch),
      processIncarnationId: assertNonempty(input?.processIncarnationId, 'process_incarnation_id_invalid')
    };
    if (identity.processIncarnationId !== this.#processIncarnationId) throw staleError();
    return identity;
  }

  #matches(binding, identity) {
    return binding?.status === 'ACTIVE' &&
      binding.targetId === identity.targetId &&
      binding.cdpTargetId === identity.cdpTargetId &&
      binding.conversationEpoch === identity.conversationEpoch &&
      binding.processIncarnationId === identity.processIncarnationId;
  }

  #assertLive(identity, generation = null) {
    if (this.#disposed) throw staleError();
    const binding = this.#bindings.get(identity.targetId);
    if (!this.#matches(binding, identity)) throw staleError();
    if (generation != null && binding.generation !== generation) throw staleError();
    return binding;
  }

  #onDetached(params) {
    const sessionId = typeof params?.sessionId === 'string' && params.sessionId ? params.sessionId : null;
    if (!sessionId) return;
    this.#lifecycleRevision += 1;
    this.#markDetached(sessionId);
    const targetId = this.#sessionTargets.get(sessionId);
    if (targetId) this.invalidateTarget(targetId, 'target_detached');
    else this.#client.rejectSession(sessionId, staleError());
  }

  #markDetached(sessionId) {
    this.#detachedSessions.add(sessionId);
    if (this.#detachedSessions.size <= 4096) return;
    this.#detachedSessions.delete(this.#detachedSessions.values().next().value);
  }

  #invalidateEngineTarget(cdpTargetId, reason) {
    if (typeof cdpTargetId !== 'string' || !cdpTargetId) return;
    this.#lifecycleRevision += 1;
    for (const binding of this.#bindings.values()) {
      if (binding.cdpTargetId === cdpTargetId) this.invalidateTarget(binding.targetId, reason);
    }
  }

  invalidateTarget(targetId, reason = 'target_invalidated') {
    const binding = this.#bindings.get(targetId);
    if (!binding) return false;
    this.#lifecycleRevision += 1;
    binding.status = 'STALE';
    binding.invalidatedReason = reason;
    this.#bindings.delete(targetId);
    this.#sessionTargets.delete(binding.sessionId);
    this.#markDetached(binding.sessionId);
    this.#client.rejectSession(binding.sessionId, staleError());
    try { this.#onTargetInvalidated?.(targetId, reason); } catch (_) {}
    return true;
  }

  async #attach(identity) {
    const existing = this.#bindings.get(identity.targetId);
    if (this.#matches(existing, identity)) return existing;
    if (existing) this.invalidateTarget(identity.targetId, 'identity_rotated');
    const lifecycleRevision = this.#lifecycleRevision;
    const result = await this.#client.call('Target.attachToTarget', {
      targetId: identity.cdpTargetId,
      flatten: true
    });
    const sessionId = assertNonempty(result?.sessionId, 'cdp_attach_session_missing');
    if (this.#disposed || this.#lifecycleRevision !== lifecycleRevision || this.#detachedSessions.has(sessionId)) {
      this.#client.rejectSession(sessionId, staleError());
      throw staleError();
    }
    const binding = {
      ...identity,
      sessionId,
      generation: ++this.#generation,
      status: 'ACTIVE'
    };
    this.#bindings.set(identity.targetId, binding);
    this.#sessionTargets.set(sessionId, identity.targetId);
    return binding;
  }

  async #acquireSlot() {
    if (this.#disposed) throw staleError();
    if (this.#inFlight < this.#maxInFlight) {
      this.#inFlight += 1;
      return;
    }
    await new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
    if (this.#disposed) throw staleError();
    this.#inFlight += 1;
  }

  #releaseSlot() {
    this.#inFlight = Math.max(0, this.#inFlight - 1);
    this.#waiters.shift()?.resolve();
  }

  #enqueue(targetId, operation) {
    const previous = this.#targetTails.get(targetId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.#targetTails.set(targetId, current);
    current.finally(() => {
      if (this.#targetTails.get(targetId) === current) this.#targetTails.delete(targetId);
    }).catch(() => {});
    return current;
  }

  run(input, operation, { deadlineMs = 10000 } = {}) {
    const identity = this.#identity(input);
    if (typeof operation !== 'function') return Promise.reject(new Error('session_operation_invalid'));
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30000) {
      return Promise.reject(new Error('session_deadline_invalid'));
    }
    return this.#enqueue(identity.targetId, async () => {
      await this.#acquireSlot();
      const deadline = Date.now() + deadlineMs;
      const eventUnsubscribers = [];
      try {
        const binding = await this.#attach(identity);
        const generation = binding.generation;
        const call = async (method, params = {}) => {
          if (typeof method !== 'string' || !method) throw new Error('session_method_invalid');
          const live = this.#assertLive(identity, generation);
          const remaining = deadline - Date.now();
          if (remaining < 1) throw new Error('snapshot_deadline_exceeded');
          try {
            return await this.#client.call(method, params, {
              sessionId: live.sessionId,
              timeoutMs: Math.min(remaining, 10000)
            });
          } catch (error) {
            if (!this.#matches(this.#bindings.get(identity.targetId), identity)) throw staleError();
            throw error;
          }
        };
        const onEvent = (method, listener) => {
          if (typeof method !== 'string' || !method || typeof listener !== 'function') throw new Error('session_event_subscription_invalid');
          const live = this.#assertLive(identity, generation);
          const sessionId = live.sessionId;
          let active = true;
          const unsubscribe = this.#client.on(method, (params, eventSessionId) => {
            if (!active || eventSessionId !== sessionId) return;
            try {
              this.#assertLive(identity, generation);
              listener(params);
            } catch (_) {}
          });
          const stop = () => {
            if (!active) return;
            active = false;
            try { unsubscribe?.(); } catch (_) {}
          };
          eventUnsubscribers.push(stop);
          return stop;
        };
        const result = await operation({ call, onEvent, sessionGeneration: generation });
        this.#assertLive(identity, generation);
        if (Date.now() > deadline) throw new Error('snapshot_deadline_exceeded');
        return result;
      } finally {
        for (const unsubscribe of eventUnsubscribers.splice(0)) {
          try { unsubscribe(); } catch (_) {}
        }
        this.#releaseSlot();
      }
    });
  }

  dispose(reason = 'scheduler_disposed') {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      try { unsubscribe?.(); } catch (_) {}
    }
    for (const targetId of this.#bindings.keys()) this.invalidateTarget(targetId, reason);
    for (const waiter of this.#waiters.splice(0)) waiter.reject(staleError());
    try { this.#onDisposed?.(reason); } catch (_) {}
  }
}
