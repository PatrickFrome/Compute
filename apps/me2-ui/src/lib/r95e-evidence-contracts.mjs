// R95E.1 pure evidence identity contracts shared by the renderer and Node tests.
// Side-effect free: stale async responses and exact-task event joins can be
// falsified without mounting React or Electron.
import { taskEventRowsConflict } from './project-action-feed.mjs';

/**
 * A fetched task-event response belongs to the current selection only when the
 * request generation and both task identities still match.
 *
 * @param {{seq:number,taskId:string}} request
 * @param {{seq:number,taskId:string|null,streamTaskId:string|null}} current
 */
export function taskStreamResponseStillCurrent(request, current) {
  const requestTaskId = String(request?.taskId ?? "");
  return Number(request?.seq) === Number(current?.seq)
    && requestTaskId !== ""
    && requestTaskId === String(current?.taskId ?? "")
    && requestTaskId === String(current?.streamTaskId ?? "");
}

/**
 * Merge the bounded global event window with a separately fetched exact-task
 * stream. Stream rows are admitted only when the stream itself is bound to the
 * same exact task identity. Duplicate event sequence numbers collapse to one.
 *
 * @param {{
 *   taskId:string|null,
 *   events?:Array<any>,
 *   streamTaskId?:string|null,
 *   stream?:Array<any>,
 *   limit?:number
 * }} input
 */
export function mergeExactTaskEvidenceEvents({
  taskId,
  events = [],
  streamTaskId = null,
  stream = [],
  limit = 40,
} = {}) {
  const id = String(taskId ?? "");
  if (!id) return [];

  const bySeq = new Map();

  // Fetched history may be older than the live global window. Admit it first,
  // then let the currently observed global event win on an identical sequence.
  if (String(streamTaskId ?? "") === id) {
    for (const event of Array.isArray(stream) ? stream : []) {
      if (String(event?.task_id ?? "") !== id) continue;
      const seq = Number(event?.seq);
      if (!Number.isSafeInteger(seq)) continue;
      bySeq.set(seq, event);
    }
  }

  for (const event of Array.isArray(events) ? events : []) {
    if (String(event?.task_id ?? "") !== id) continue;
    const seq = Number(event?.seq);
    if (!Number.isSafeInteger(seq)) continue;
    bySeq.set(seq, event);
  }

  const boundedLimit = Math.max(1, Math.min(200, Number.isSafeInteger(Number(limit)) ? Number(limit) : 40));
  return [...bySeq.values()]
    .sort((a, b) => Number(b.seq) - Number(a.seq))
    .slice(0, boundedLimit);
}


/**
 * Resolve one bounded exact-task history response into a presentation patch.
 * The helper is pure so the same race semantics used by Zustand can be tested
 * with real delayed-response ordering rather than source-text assertions.
 *
 * @param {{
 *   request:{seq:number,taskId:string},
 *   current:{seq:number,taskId:string|null,streamTaskId:string|null,stream?:Array<any>,conflicted?:boolean},
 *   responseEvents?:Array<any>|null,
 *   limit?:number
 * }} input
 */
export function resolveExactTaskStreamResponse({
  request,
  current,
  responseEvents = null,
  limit = 200,
} = {}) {
  if (!taskStreamResponseStillCurrent(request, current)) {
    return Object.freeze({ applied: false, patch: null });
  }

  if (!Array.isArray(responseEvents)) {
    return Object.freeze({
      applied: true,
      patch: Object.freeze({ streamState: 'DEGRADED' }),
    });
  }
  if (current?.conflicted === true) {
    return Object.freeze({ applied: true, conflict: true, patch: Object.freeze({ streamState: 'DEGRADED' }) });
  }

  const taskId = String(request?.taskId ?? '');
  const exactRows = rows => (Array.isArray(rows) ? rows : []).filter(event =>
    String(event?.task_id ?? '') === taskId && Number.isSafeInteger(event?.seq));
  const fetched = exactRows(responseEvents);
  const live = exactRows(current?.stream);
  // A durable sequence identifies immutable bytes. Contradictory rows cannot
  // be repaired by choosing whichever transport happened to respond last.
  if (taskEventRowsConflict(fetched, fetched) || taskEventRowsConflict(fetched, live)) {
    return Object.freeze({ applied: true, conflict: true, patch: Object.freeze({ streamState: 'DEGRADED' }) });
  }
  const bySeq = new Map();

  for (const event of responseEvents) {
    if (String(event?.task_id ?? '') !== taskId) continue;
    const seq = Number(event?.seq);
    if (!Number.isSafeInteger(seq)) continue;
    bySeq.set(seq, event);
  }

  // Identical live rows observed after the fetch began can be deduplicated.
  for (const event of Array.isArray(current?.stream) ? current.stream : []) {
    if (String(event?.task_id ?? '') !== taskId) continue;
    const seq = Number(event?.seq);
    if (!Number.isSafeInteger(seq)) continue;
    bySeq.set(seq, event);
  }

  const boundedLimit = Math.max(
    1,
    Math.min(200, Number.isSafeInteger(Number(limit)) ? Number(limit) : 200),
  );
  const stream = [...bySeq.values()]
    .sort((a, b) => Number(a.seq) - Number(b.seq))
    .slice(-boundedLimit);

  return Object.freeze({
    applied: true,
    patch: Object.freeze({
      stream: Object.freeze(stream),
      streamState: 'EXACT',
    }),
  });
}
