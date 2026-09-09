export class BrowserBrainFanoutPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BrowserBrainFanoutPlanError';
    this.code = code;
    this.details = details;
  }
}

function defaultResolveCellKey(command) {
  return command?.payload?.tab_id ?? null;
}

function finitePositiveInteger(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function preflightAbortError() {
  return new BrowserBrainFanoutPlanError('aborted', 'fanout aborted before any effect');
}

async function awaitPreflight(preflightPromise, signal) {
  if (!signal) return preflightPromise;

  let removeAbortListener = () => {};
  const abortPromise = new Promise((_, reject) => {
    const rejectAbort = () => reject(preflightAbortError());
    if (signal.aborted) {
      rejectAbort();
      return;
    }
    signal.addEventListener('abort', rejectAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', rejectAbort);
  });

  try {
    return await Promise.race([preflightPromise, abortPromise]);
  } finally {
    removeAbortListener();
  }
}

/**
 * One-shot, provider-neutral BrowserCell fan-out.
 *
 * This component is deliberately not a scheduler or queue. The existing
 * control-plane scheduler decides which commands are eligible. This layer only
 * proves that one already-selected batch can execute concurrently when every
 * command is bound to a distinct BrowserCell and fits the current pressure
 * budget.
 *
 * Invariants:
 * - no selected/platform fallback; a stable BrowserCell key is mandatory
 * - no same-cell overlap inside a batch
 * - no hidden queue when pressure budget is insufficient
 * - no retry after executor rejection or ambiguous physical effects
 * - command objects remain opaque/provider-neutral
 */
export class BrowserBrainParallelFanoutCoordinator {
  constructor({
    execute,
    resolveCellKey = defaultResolveCellKey,
    readMutationBudget = () => 1,
    hardBatchLimit = 128,
  } = {}) {
    if (typeof execute !== 'function') {
      throw new TypeError('execute must be a function');
    }
    if (typeof resolveCellKey !== 'function') {
      throw new TypeError('resolveCellKey must be a function');
    }
    if (typeof readMutationBudget !== 'function') {
      throw new TypeError('readMutationBudget must be a function');
    }

    this.execute = execute;
    this.resolveCellKey = resolveCellKey;
    this.readMutationBudget = readMutationBudget;
    this.hardBatchLimit = finitePositiveInteger(hardBatchLimit, 128);
  }

  async dispatch(commands, { signal } = {}) {
    if (!Array.isArray(commands)) {
      throw new BrowserBrainFanoutPlanError('invalid_batch', 'commands must be an array');
    }
    if (commands.length === 0) return [];
    if (commands.length > this.hardBatchLimit) {
      throw new BrowserBrainFanoutPlanError(
        'hard_batch_limit',
        `batch size ${commands.length} exceeds hard limit ${this.hardBatchLimit}`,
        { batch_size: commands.length, hard_batch_limit: this.hardBatchLimit },
      );
    }
    if (signal?.aborted) {
      throw preflightAbortError();
    }

    const seenCommandIds = new Set();
    const plan = [];

    for (const command of commands) {
      const commandId = typeof command?.command_id === 'string' ? command.command_id.trim() : '';
      if (!commandId) {
        throw new BrowserBrainFanoutPlanError('missing_command_id', 'every fanout command needs command_id');
      }
      if (seenCommandIds.has(commandId)) {
        throw new BrowserBrainFanoutPlanError('duplicate_command_id', `duplicate command_id ${commandId}`);
      }
      seenCommandIds.add(commandId);
      plan.push({ command, commandId, cellKey: null });
    }

    // Pressure admission and BrowserCell resolution are both read-only preflight
    // seams and may independently be provider-backed. Defer every invocation into
    // its own microtask so a synchronous throw from one adapter cannot prevent the
    // remaining read-only preflight work from starting. Promise.all still fails
    // closed before any physical effect if any preflight lane rejects. Race that
    // aggregate against AbortSignal so cancellation does not wait for a slow or
    // wedged provider-backed read-only preflight lane to settle.
    const budgetPromise = Promise.resolve().then(() => this.readMutationBudget());
    const cellKeyPromises = plan.map(({ command }) =>
      Promise.resolve().then(() => this.resolveCellKey(command)),
    );
    const preflightPromise = Promise.all([
      budgetPromise,
      Promise.all(cellKeyPromises),
    ]);
    const [rawBudget, rawCellKeys] = await awaitPreflight(preflightPromise, signal);
    if (signal?.aborted) {
      throw preflightAbortError();
    }

    const budget = finitePositiveInteger(rawBudget, 1);
    if (commands.length > budget) {
      throw new BrowserBrainFanoutPlanError(
        'pressure_budget_exceeded',
        `batch size ${commands.length} exceeds current mutation budget ${budget}`,
        { batch_size: commands.length, mutation_budget: budget },
      );
    }

    const seenCells = new Set();
    for (let index = 0; index < plan.length; index += 1) {
      const entry = plan[index];
      const rawCellKey = rawCellKeys[index];
      const cellKey = typeof rawCellKey === 'string' ? rawCellKey.trim() : '';
      if (!cellKey) {
        throw new BrowserBrainFanoutPlanError(
          'missing_browser_cell',
          `command ${entry.commandId} has no explicit BrowserCell binding`,
          { command_id: entry.commandId },
        );
      }
      if (seenCells.has(cellKey)) {
        throw new BrowserBrainFanoutPlanError(
          'same_cell_overlap',
          `batch contains overlapping mutation for BrowserCell ${cellKey}`,
          { browser_cell: cellKey },
        );
      }
      seenCells.add(cellKey);
      entry.cellKey = cellKey;
    }

    // Do not add a semaphore or internal queue here. The batch was admitted as a
    // whole against the pressure budget, so all independent cells can start now.
    // Defer each executor invocation into its own microtask so a synchronous throw
    // from one provider adapter is captured as that command's rejection instead of
    // aborting array construction and suppressing later independent BrowserCells.
    // Re-check abort at each execution-start boundary as well: an earlier adapter
    // may synchronously abort the shared signal after an effect starts, and later
    // peers must then fail closed rather than begin new physical effects.
    const settled = await Promise.allSettled(
      plan.map(({ command, commandId, cellKey }) =>
        Promise.resolve().then(() => {
          if (signal?.aborted) {
            throw new BrowserBrainFanoutPlanError(
              'aborted',
              `fanout aborted before command ${commandId} effect started`,
              { command_id: commandId, browser_cell: cellKey },
            );
          }
          return this.execute(command, {
            commandId,
            browserCell: cellKey,
            signal,
          });
        }),
      ),
    );

    return settled.map((result, index) => {
      const { commandId, cellKey } = plan[index];
      if (result.status === 'fulfilled') {
        return {
          command_id: commandId,
          browser_cell: cellKey,
          status: 'fulfilled',
          value: result.value,
        };
      }
      return {
        command_id: commandId,
        browser_cell: cellKey,
        status: 'rejected',
        reason: result.reason,
      };
    });
  }
}
