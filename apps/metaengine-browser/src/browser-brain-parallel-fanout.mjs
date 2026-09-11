export class BrowserBrainFanoutPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BrowserBrainFanoutPlanError';
    this.code = code;
    this.details = details;
  }
}

const DEFERRED_TURN = Promise.resolve();

function defaultResolveCellKey(command) {
  return command?.payload?.tab_id ?? null;
}

function strictHardBatchLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BrowserBrainFanoutPlanError(
      'invalid_hard_batch_limit',
      'hard batch limit must be a positive safe integer',
      { hard_batch_limit: value },
    );
  }
  return value;
}

function strictMutationBudget(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BrowserBrainFanoutPlanError(
      'invalid_mutation_budget',
      'current mutation budget must be a positive safe integer',
      { mutation_budget: value },
    );
  }
  return value;
}

function strictBrowserCellKey(rawCellKey, commandId) {
  const cellKey = typeof rawCellKey === 'string' ? rawCellKey.trim() : '';
  if (!cellKey) {
    throw new BrowserBrainFanoutPlanError(
      'missing_browser_cell',
      `command ${commandId} has no explicit BrowserCell binding`,
      { command_id: commandId },
    );
  }
  return cellKey;
}

function pressureBudgetExceededError(batchSize, budget) {
  return new BrowserBrainFanoutPlanError(
    'pressure_budget_exceeded',
    `batch size ${batchSize} exceeds current mutation budget ${budget}`,
    { batch_size: batchSize, mutation_budget: budget },
  );
}

function sameCellOverlapError(cellKey) {
  return new BrowserBrainFanoutPlanError(
    'same_cell_overlap',
    `batch contains overlapping mutation for BrowserCell ${cellKey}`,
    { browser_cell: cellKey },
  );
}

function preflightAbortError() {
  return new BrowserBrainFanoutPlanError('aborted', 'fanout aborted before any effect');
}

function awaitPreflight(preflightPromise, signal) {
  // The overwhelmingly common signal-less path can return the aggregate directly.
  // Keeping this helper synchronous avoids one async-function adoption Promise per
  // admitted batch while preserving the exact same await boundary in dispatch().
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

  return Promise.race([preflightPromise, abortPromise]).finally(removeAbortListener);
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
    this.hardBatchLimit = strictHardBatchLimit(hardBatchLimit);
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
    const plan = new Array(commands.length);

    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      const commandId = typeof command?.command_id === 'string' ? command.command_id.trim() : '';
      if (!commandId) {
        throw new BrowserBrainFanoutPlanError('missing_command_id', 'every fanout command needs command_id');
      }
      if (seenCommandIds.has(commandId)) {
        throw new BrowserBrainFanoutPlanError('duplicate_command_id', `duplicate command_id ${commandId}`);
      }
      seenCommandIds.add(commandId);
      plan[index] = { command, commandId, cellKey: null };
    }

    // Pressure admission and BrowserCell resolution are independent read-only
    // preflight seams. Start every lane before awaiting any one of them; no
    // physical effect is possible until the aggregate has passed. Reuse one
    // already-resolved turn promise to defer every provider seam without creating
    // a fresh resolved promise per lane. Validate each lane as it settles so
    // malformed pressure, insufficient budget, missing exact-cell evidence, or a
    // proven same-cell collision can reject immediately without waiting for
    // unrelated slow/wedged preflight. Bind each exact cell directly onto its plan
    // entry while the resolver lane settles so large batches avoid a second
    // cell-key result vector and post-preflight mapping pass.
    const budgetPromise = DEFERRED_TURN
      .then(() => this.readMutationBudget())
      .then(strictMutationBudget)
      .then((budget) => {
        if (commands.length > budget) {
          throw pressureBudgetExceededError(commands.length, budget);
        }
        return budget;
      });
    const seenCells = new Set();
    const preflightPromises = new Array(plan.length + 1);
    preflightPromises[0] = budgetPromise;
    for (let index = 0; index < plan.length; index += 1) {
      const entry = plan[index];
      preflightPromises[index + 1] = DEFERRED_TURN
        .then(() => this.resolveCellKey(entry.command))
        .then((rawCellKey) => strictBrowserCellKey(rawCellKey, entry.commandId))
        .then((cellKey) => {
          if (seenCells.has(cellKey)) {
            throw sameCellOverlapError(cellKey);
          }
          seenCells.add(cellKey);
          entry.cellKey = cellKey;
        });
    }
    const preflightPromise = Promise.all(preflightPromises);
    await awaitPreflight(preflightPromise, signal);
    if (signal?.aborted) throw preflightAbortError();

    // All independent cells may start after one-shot admission. Preallocate the
    // exact bounded execution vector and let each lane own its settlement mapping
    // so the hot path avoids both dynamic growth and a map-created promise vector.
    // Reuse the same resolved turn promise to isolate synchronous provider throws
    // without allocating one throwaway resolved promise per effect lane. Abort is
    // checked again at each execution-start boundary so a prior peer cannot cause
    // later physical effects to start after shared cancellation.
    const executionPromises = new Array(plan.length);
    for (let index = 0; index < plan.length; index += 1) {
      const { command, commandId, cellKey } = plan[index];
      executionPromises[index] = DEFERRED_TURN
        .then(() => {
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
        })
        .then(
          (value) => ({
            command_id: commandId,
            browser_cell: cellKey,
            status: 'fulfilled',
            value,
          }),
          (reason) => ({
            command_id: commandId,
            browser_cell: cellKey,
            status: 'rejected',
            reason,
          }),
        );
    }
    return Promise.all(executionPromises);
  }
}
