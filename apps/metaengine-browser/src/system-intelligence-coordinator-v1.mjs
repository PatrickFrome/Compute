import { SystemIntelligence } from './system-intelligence-v1.mjs';
import { AutonomousWorkScheduler } from './autonomous-work-scheduler-v1.mjs';
import { ProcessObserverRuntime } from './process-observer-runtime-v1.mjs';

export const SYSTEM_INTELLIGENCE_COORDINATOR_VERSION = '1.0.0';

export class SystemIntelligenceCoordinator {
  #store;
  #intelligence;
  #scheduler;
  #observer;

  constructor({ store, processSources = [], clock = () => Date.now(), uuid, observerIntervalMs = 5000 } = {}) {
    if (!store || typeof store.init !== 'function') throw new Error('system_intelligence_coordinator_store_required');
    this.#store = store;
    const options = { store, clock, ...(uuid ? { uuid } : {}) };
    this.#intelligence = new SystemIntelligence(options);
    this.#scheduler = new AutonomousWorkScheduler(options);
    this.#observer = new ProcessObserverRuntime({
      intelligence: this.#intelligence,
      sources: processSources,
      clock,
      intervalMs: observerIntervalMs,
    });
  }

  async init({ startObserver = false } = {}) {
    await this.#store.init();
    if (startObserver) this.#observer.start();
    return this.snapshot();
  }

  async reconcileNow() {
    await this.#observer.pollOnce();
    return this.snapshot();
  }

  async planIndependentWork(input = {}) {
    const plan = this.#scheduler.plan(input);
    await this.#scheduler.recordDecision(plan);
    return plan;
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser.system-intelligence-coordinator.snapshot.v1',
      version: SYSTEM_INTELLIGENCE_COORDINATOR_VERSION,
      intelligence: this.#intelligence.snapshot(),
      observer: this.#observer.snapshot(),
      policy: {
        process_observation_authority_effect: false,
        autonomous_planning_authority_effect: false,
        autonomous_assignment_requires_existing_typed_fleet_runtime: true,
        mainline_promotion_authority: false,
      },
      authority_effect: false,
    });
  }

  stop() { return this.#observer.stop(); }
  get intelligence() { return this.#intelligence; }
  get scheduler() { return this.#scheduler; }
}
