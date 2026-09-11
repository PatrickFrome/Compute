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

function admitCell(cellKeys, seenCells, index, rawCellKey, commandId) {
  const cellKey = strictBrowserCellKey(rawCellKey, commandId);
  if (seenCells.has(cellKey)) throw sameCellOverlapError(cellKey);
  seenCells.add(cellKey);
  cellKeys[index] = cellKey;
}

function preflightAbortError() {
  return new BrowserBrainFanoutPlanError('aborted', 'fanout aborted before any effect');
}

function awaitPreflight(preflightPromise, signal) {
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

function validateMutationBudget(rawBudget, batchSize) {
  const budget = strictMutationBudget(rawBudget);
  if (batchSize > budget) {
    throw pressureBudgetExceededError(batchSize, budget);
  }
  return budget;
}

function isThenable(value) {
  return value != null && typeof value.then === 'function';
}

function deferBudgetAdmission(readMutationBudget, batchSize) {
  return DEFERRED_TURN.then(() => {
    const rawBudget = readMutationBudget();
    if (isThenable(rawBudget)) {
      return Promise.resolve(rawBudget)
        .then((budget) => validateMutationBudget(budget, batchSize));
    }
    return validateMutationBudget(rawBudget, batchSize);
  });
}

function deferCellAdmission(resolveCellKey, command, commandId, cellKeys, seenCells, index) {
  return DEFERRED_TURN.then(() => {
    const rawCellKey = resolveCellKey(command);
    if (isThenable(rawCellKey)) {
      return Promise.resolve(rawCellKey)
        .then((cellKey) => admitCell(cellKeys, seenCells, index, cellKey, commandId));
    }
    return admitCell(cellKeys, seenCells, index, rawCellKey, commandId);
  });
}

async function executeLane(execute, command, commandId, cellKey, signal) {
  if (signal?.aborted) {
    return {
      command_id: commandId,
      browser_cell: cellKey,
      status: 'rejected',
      reason: new BrowserBrainFanoutPlanError(
        'aborted',
        `fanout aborted before command ${commandId} effect started`,
        { command_id: commandId, browser_cell: cellKey },
      ),
    };
  }

  try {
    const value = await execute(command, {
      commandId,
      browserCell: cellKey,
      signal,
    });
    return {
      command_id: commandId,
      browser_cell: cellKey,
      status: 'fulfilled',
      value,
    };
  } catch (reason) {
    return {
      command_id: commandId,
      browser_cell: cellKey,
      status: 'rejected',
      reason,
    };
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
    this.usesDefaultCellResolver = resolveCellKey === defaultResolveCellKey;
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
    const seenCells = new Set();
    const commandIds = new Array(commands.length);
    const cellKeys = new Array(commands.length);

    // Keep caller-owned commands opaque and carry fan-out metadata in dense
    // sidecar vectors. This avoids allocating one short-lived plan object per
    // command while preserving stable caller order across preflight/execution.
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      const commandId = typeof command?.command_id === 'string'
        ? command.command_id.trim()
        : '';
      if (!commandId) {
        throw new BrowserBrainFanoutPlanError('missing_command_id', 'every fanout command needs command_id');
      }
      if (seenCommandIds.has(commandId)) {
        throw new BrowserBrainFanoutPlanError('duplicate_command_id', `duplicate command_id ${commandId}`);
      }
      seenCommandIds.add(commandId);
      commandIds[index] = commandId;

      // The built-in resolver is a pure field projection. Resolve it in the
      // already-required synchronous validation pass so the common BrowserCell
      // path does not allocate one deferred Promise/reaction lane per command.
      if (this.usesDefaultCellResolver) {
        admitCell(cellKeys, seenCells, index, defaultResolveCellKey(command), commandId);
      }
    }

    let preflightPromise;
    if (this.usesDefaultCellResolver) {
      // Preserve the provider seam: budget reads remain deferred from the caller
      // turn. Synchronous process-local budgets validate inside that same
      // deferred reaction; async/thenable providers retain awaited validation.
      preflightPromise = deferBudgetAdmission(this.readMutationBudget, commands.length);
    } else {
      const preflightPromises = new Array(commands.length + 1);
      preflightPromises[0] = deferBudgetAdmission(this.readMutationBudget, commands.length);
      for (let index = 0; index < commands.length; index += 1) {
        preflightPromises[index + 1] = deferCellAdmission(
          this.resolveCellKey,
          commands[index],
          commandIds[index],
          cellKeys,
          seenCells,
          index,
        );
      }
      preflightPromise = Promise.all(preflightPromises);
    }

    await awaitPreflight(preflightPromise, signal);
    if (signal?.aborted) throw preflightAbortError();

    const executionPromises = new Array(commands.length);
    for (let index = 0; index < commands.length; index += 1) {
      executionPromises[index] = executeLane(
        this.execute,
        commands[index],
        commandIds[index],
        cellKeys[index],
        signal,
      );
    }
    return Promise.all(executionPromises);
  }
}
