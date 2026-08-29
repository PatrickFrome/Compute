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
    this.healthCheckTimer = setInterval(() => this.checkAll(), this.healthCheckIntervalMs);
    // Library-hygiene invariant: a health probe timer must never pin the host
    // process event loop. The daemon stays alive through its RPC server and
    // serve loop; hosts (tests, embedders) exit when their own work drains.
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
  }

  assignForActuation() {
    return this.assign(NODE_CAPABILITIES.ACTUATION);
  }
}

