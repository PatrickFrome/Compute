import { BrowserNode, NodeRegistry, NODE_CAPABILITIES, NODE_HEALTH } from '../../browser-shared/node-registry.mjs';

export class LocalNodeRegistry extends NodeRegistry {
  constructor(runtime, options = {}) {
    super(options);
    this.runtime = runtime;
    this.healthCheckTimer = null;
    this.localNodeId = options.localNodeId || `node-${runtime.stateRoot.split(/[\\/]/).pop()}`;
  }

  async start() {
    const localNode = new BrowserNode({
      nodeId: this.localNodeId,
      endpoint: `local:${this.runtime.stateRoot}`,
      capabilities: [NODE_CAPABILITIES.ACTUATION, NODE_CAPABILITIES.PERCEPTION, NODE_CAPABILITIES.CONTEXT_MANAGEMENT, NODE_CAPABILITIES.TARGET_MANAGEMENT],
      nodeType: 'local'
    });
    this.register(localNode);
    // Library-hygiene invariants: (1) a health probe timer must never pin the
    // host process event loop — the daemon stays alive through its RPC server
    // and serve loop, hosts (tests, embedders) exit when their own work drains;
    // (2) an unguarded rejection inside the interval would escalate to an
    // unhandled rejection and kill the host process — sweep failures are
    // already recorded per-node as UNHEALTHY, so the promise is settled
    // explicitly and never left floating.
    this.healthCheckTimer = setInterval(() => {
      Promise.resolve(this.checkAll()).catch(() => {});
    }, this.healthCheckIntervalMs);
    this.healthCheckTimer.unref?.();
    await this.checkAll();
    return localNode;
  }

  async stop() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.nodes.clear();
    this.assignmentCounters.clear();
  }

  async checkAll() {
    // Re-entrance guard: a slow runtime.health() (or a tight probe interval)
    // must not stack concurrent sweeps against the same node set — the first
    // in-flight sweep owns the pass, later callers coalesce onto it.
    if (this._checkAllInFlight) return;
    this._checkAllInFlight = true;
    try {
      for (const node of this.nodes.values()) {
        try {
          if (node.nodeType === 'local') {
            const health = await this.runtime.health();
            node.updateHealth(health.ok !== false ? NODE_HEALTH.HEALTHY : NODE_HEALTH.UNHEALTHY, { profiles: health.profiles?.length || 0 });
          } else {
            node.updateHealth(NODE_HEALTH.UNKNOWN, { reason: 'remote_probe_not_implemented' });
          }
        } catch (_) {
          node.updateHealth(NODE_HEALTH.UNHEALTHY, { reason: 'health_check_failed' });
        }
      }
      this.markStale();
    } finally {
      this._checkAllInFlight = false;
    }
  }

  assignForActuation() {
    return this.assign(NODE_CAPABILITIES.ACTUATION);
  }
}

