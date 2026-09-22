import { BrowserControlPressureGovernor } from './browser-control-pressure-governor.mjs';
import { BrowserBrainParallelFanoutCoordinator } from './browser-brain-parallel-fanout.mjs';
import { classifyNativeSupervisorCommand, COMMAND_LANES } from './native-supervisor-command-lanes.mjs';

export const BROWSER_BRAIN_ADAPTIVE_FANOUT_RUNTIME_SCHEMA = 'metaengine.browser-brain.adaptive-fanout-runtime.v1';

function explicitCell(command) {
  const value = String(command?.payload?.tab_id || '').trim();
  return value || null;
}

/**
 * Composition seam between live Browser pressure, the existing command-lane
 * scheduler, and the already-proven runtime-fenced mutation executor.
 *
 * This component has no lease authority, timer, queue, retry loop, or physical
 * effect implementation. One externally-produced pressure sample tunes the
 * existing scheduler and the one-shot BrowserCell fan-out budget atomically.
 */
export class BrowserBrainAdaptiveFanoutRuntime {
  #governor;
  #scheduler;
  #fanout;
  #budget;

  constructor({
    scheduler,
    executeRuntimeFenced,
    governor = new BrowserControlPressureGovernor(),
    hardBatchLimit = 128,
  } = {}) {
    if (!scheduler || typeof scheduler.setConcurrencyBudget !== 'function') {
      throw new TypeError('scheduler with setConcurrencyBudget is required');
    }
    if (typeof executeRuntimeFenced !== 'function') {
      throw new TypeError('executeRuntimeFenced must be a function');
    }
    if (!governor || typeof governor.observe !== 'function' || typeof governor.snapshot !== 'function') {
      throw new TypeError('pressure governor is required');
    }

    this.#scheduler = scheduler;
    this.#governor = governor;
    this.#budget = governor.snapshot({ liveCells: 1 });
    this.#scheduler.setConcurrencyBudget(this.#budget);
    this.#fanout = new BrowserBrainParallelFanoutCoordinator({
      hardBatchLimit,
      resolveCellKey: explicitCell,
      readMutationBudget: () => this.#budget.mutation_concurrency,
      execute: (command, context) => executeRuntimeFenced(command, context),
    });
  }

  observePressure(sample = {}) {
    const next = this.#governor.observe(sample);
    const schedulerSnapshot = this.#scheduler.setConcurrencyBudget(next);
    this.#budget = next;
    return this.#snapshotWithScheduler(
      schedulerSnapshot ?? this.#scheduler.snapshot?.() ?? null,
    );
  }

  async dispatchMutations(commands, options = {}) {
    if (!Array.isArray(commands)) throw new TypeError('commands must be an array');
    for (const command of commands) {
      const descriptor = classifyNativeSupervisorCommand(command);
      if (descriptor.lane !== COMMAND_LANES.TAB_MUTATION || descriptor.read_only || descriptor.exclusive) {
        throw new Error(`browser_brain_adaptive_fanout_tab_mutation_required:${descriptor.action}`);
      }
    }
    return this.#fanout.dispatch(commands, options);
  }

  snapshot() {
    return this.#snapshotWithScheduler(this.#scheduler.snapshot?.() || null);
  }

  #snapshotWithScheduler(scheduler) {
    return Object.freeze({
      schema: BROWSER_BRAIN_ADAPTIVE_FANOUT_RUNTIME_SCHEMA,
      pressure_band: this.#budget.pressure_band,
      read_concurrency: this.#budget.read_concurrency,
      mutation_concurrency: this.#budget.mutation_concurrency,
      resource_sample_ms: this.#budget.resource_sample_ms,
      scheduler,
      scheduler_authority: false,
      command_leasing: false,
      dedicated_timer: false,
      second_scheduler: false,
      hidden_queue: false,
      runtime_fence_bypass_allowed: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}
