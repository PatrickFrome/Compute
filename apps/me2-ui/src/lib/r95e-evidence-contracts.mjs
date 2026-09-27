// R95E.1 pure evidence identity contracts shared by the renderer and Node tests.
// Side-effect free: stale async responses and exact-task event joins can be
// falsified without mounting React or Electron.

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
  for (const event of Array.isArray(events) ? events : []) {
    if (String(event?.task_id ?? "") !== id) continue;
    const seq = Number(event?.seq);
    if (!Number.isSafeInteger(seq)) continue;
    bySeq.set(seq, event);
  }

  if (String(streamTaskId ?? "") === id) {
    for (const event of Array.isArray(stream) ? stream : []) {
      if (String(event?.task_id ?? "") !== id) continue;
      const seq = Number(event?.seq);
      if (!Number.isSafeInteger(seq)) continue;
      bySeq.set(seq, event);
    }
  }

  const boundedLimit = Math.max(1, Math.min(200, Number.isSafeInteger(Number(limit)) ? Number(limit) : 40));
  return [...bySeq.values()]
    .sort((a, b) => Number(b.seq) - Number(a.seq))
    .slice(0, boundedLimit);
}
