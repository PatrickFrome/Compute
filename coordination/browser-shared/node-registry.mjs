export const NODE_CAPABILITIES = Object.freeze({
  ACTUATION: 'actuation',
  PERCEPTION: 'perception',
  CONTEXT_MANAGEMENT: 'context_management',
  TARGET_MANAGEMENT: 'target_management'
});

export const NODE_HEALTH = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown'
});

export class BrowserNode {
  constructor({ nodeId, endpoint, capabilities = [], nodeType = 'local' } = {}) {
    if (!nodeId || typeof nodeId !== 'string') throw new Error('node_id_required');
    if (!endpoint || typeof endpoint !== 'string') throw new Error('node_endpoint_required');
    this.nodeId = String(nodeId).trim();
    this.endpoint = String(endpoint).trim();
    this.capabilities = Array.isArray(capabilities) ? capabilities.filter((c) => Object.values(NODE_CAPABILITIES).includes(c)) : [];
    this.nodeType = ['local', 'remote'].includes(nodeType) ? nodeType : 'local';
    this.health = NODE_HEALTH.UNKNOWN;
    this.lastHealthCheck = null;
    this.registeredAt = new Date().toISOString();
    this.metadata = {};
  }

  updateHealth(health, metadata = {}) {
    if (!Object.values(NODE_HEALTH).includes(health)) throw new Error('node_health_invalid');
    this.health = health;
    this.lastHealthCheck = new Date().toISOString();
    this.metadata = { ...this.metadata, ...metadata };
  }

  hasCapability(capability) {
    return this.capabilities.includes(capability);
  }

  toJSON() {
    return {
      nodeId: this.nodeId,
      endpoint: this.endpoint,
      capabilities: this.capabilities,
      nodeType: this.nodeType,
      health: this.health,
      lastHealthCheck: this.lastHealthCheck,
      registeredAt: this.registeredAt,
      metadata: this.metadata
    };
  }
}

export class NodeRegistry {
  constructor({ healthCheckIntervalMs = 30000, staleThresholdMs = 120000 } = {}) {
    this.healthCheckIntervalMs = Math.max(5000, Number(healthCheckIntervalMs) || 30000);
    this.staleThresholdMs = Math.max(this.healthCheckIntervalMs * 2, Number(staleThresholdMs) || 120000);
    this.nodes = new Map();
    this.assignmentCounters = new Map();
  }

  register(node) {
    if (!(node instanceof BrowserNode)) throw new Error('node_invalid');
    this.nodes.set(node.nodeId, node);
    this.assignmentCounters.set(node.nodeId, 0);
    return node;
  }

  deregister(nodeId) {
    this.nodes.delete(nodeId);
    this.assignmentCounters.delete(nodeId);
  }

  get(nodeId) {
    return this.nodes.get(nodeId) || null;
  }

  getAll() {
    return Array.from(this.nodes.values());
  }

  getHealthy() {
    return this.getAll().filter((node) => node.health === NODE_HEALTH.HEALTHY);
  }

  getByCapability(capability) {
    return this.getHealthy().filter((node) => node.hasCapability(capability));
  }

  assign(capability) {
    const candidates = this.getByCapability(capability);
    if (candidates.length === 0) return null;
    
    let minCount = Infinity;
    let selected = candidates[0];
    for (const node of candidates) {
      const count = this.assignmentCounters.get(node.nodeId) || 0;
      if (count < minCount) {
        minCount = count;
        selected = node;
      }
    }
    this.assignmentCounters.set(selected.nodeId, minCount + 1);
    return selected;
  }

  markStale() {
    const now = Date.now();
    for (const node of this.nodes.values()) {
      if (!node.lastHealthCheck) continue;
      const age = now - new Date(node.lastHealthCheck).getTime();
      if (age > this.staleThresholdMs && node.health === NODE_HEALTH.HEALTHY) {
        node.updateHealth(NODE_HEALTH.DEGRADED, { reason: 'health_check_stale' });
      }
    }
  }
}


