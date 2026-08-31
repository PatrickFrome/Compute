const TERMINAL_LIFECYCLES = new Set(['LOST', 'RETIRED', 'PROVISIONING_AMBIGUOUS']);

function text(value) { return String(value ?? '').trim(); }
function rotate(rows, offset) {
  if (!rows.length) return [];
  const start = Math.abs(Number(offset) || 0) % rows.length;
  return [...rows.slice(start), ...rows.slice(0, start)];
}

/**
 * Plan a bounded worker observation pass. Terminal lifecycle rows never require
 * physical CAPTURE. Previously-generating workers receive priority, while a
 * round-robin cursor prevents a large fleet from starving later workers.
 * Unsampled workers retain their prior generation state rather than inventing
 * an IDLE edge.
 */
export function planWorkerObservation({ agents = [], previous_generation = {}, cursor = 0, budget = 4 } = {}) {
  const cap = Math.max(1, Math.min(16, Number(budget) || 4));
  const normalized = (Array.isArray(agents) ? agents : []).map((agent, index) => ({
    agent,
    index,
    agent_id: text(agent?.agent_id),
    tab_id: text(agent?.tab_id),
    lifecycle_state: text(agent?.lifecycle_state).toUpperCase(),
    previous_state: text(previous_generation?.[text(agent?.agent_id)] || 'UNKNOWN').toUpperCase(),
  })).filter((row) => row.agent_id);

  const terminal = normalized.filter((row) => TERMINAL_LIFECYCLES.has(row.lifecycle_state));
  const live = normalized.filter((row) => !TERMINAL_LIFECYCLES.has(row.lifecycle_state) && row.tab_id);
  const generating = live.filter((row) => row.previous_state === 'GENERATING');
  const other = live.filter((row) => row.previous_state !== 'GENERATING');

  const picked = [];
  const pickedIds = new Set();
  for (const row of rotate(generating, cursor)) {
    if (picked.length >= cap) break;
    picked.push(row); pickedIds.add(row.agent_id);
  }
  for (const row of rotate(other, cursor)) {
    if (picked.length >= cap) break;
    if (!pickedIds.has(row.agent_id)) { picked.push(row); pickedIds.add(row.agent_id); }
  }

  const signals = normalized.map((row) => ({
    agent_id: row.agent_id,
    lifecycle_state: row.lifecycle_state,
    generation_state: TERMINAL_LIFECYCLES.has(row.lifecycle_state)
      ? 'TERMINAL'
      : (row.previous_state || 'UNKNOWN'),
    capture_required: pickedIds.has(row.agent_id),
    tab_id: row.tab_id || null,
  }));

  return Object.freeze({
    budget: cap,
    capture_count: picked.length,
    capture_agents: picked.map((row) => Object.freeze({ agent_id: row.agent_id, tab_id: row.tab_id })),
    signals,
    next_cursor: normalized.length ? (Math.abs(Number(cursor) || 0) + Math.max(1, picked.length)) % normalized.length : 0,
    terminal_count: terminal.length,
    authority_effect: false,
  });
}
