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
 * Reduce one completed exact-task history fetch into presentation state.
 * Returns null when the response is stale and must have zero state effect.
 *
 * @param {{
 *   request:{seq:number,taskId:string},
 *   current:{seq:number,taskId:string|null,streamTaskId:string|null},
 *   fetchedEvents?:Array<any>|null,
 *   liveStream?:Array<any>
 * }} input
 */
export function reduceExactTaskHistoryResponse({
  request,
  current,
  fetchedEvents = null,
  liveStream = [],
} = {}) {
  if (!taskStreamResponseStillCurrent(request, current)) return null;

  const stream = Array.isArray(liveStream) ? liveStream : [];
  if (!Array.isArray(fetchedEvents)) {
    return Object.freeze({
      stream,
      streamState: "DEGRADED",
    });
  }

  const exactTaskId = String(request?.taskId ?? "");
  const bySeq = new Map();
  for (const event of fetchedEvents) {
    if (String(event?.task_id ?? "") !== exactTaskId) continue;
    const seq = Number(event?.seq);
    if (!Number.isSafeInteger(seq)) continue;
    bySeq.set(seq, event);
  }
  // Live rows are newer observations and therefore win duplicate sequence ids.
  for (const event of stream) {
    if (String(event?.task_id ?? "") !== exactTaskId) continue;
    const seq = Number(event?.seq);
    if (!Number.isSafeInteger(seq)) continue;
    bySeq.set(seq, event);
  }

  return Object.freeze({
    stream: [...bySeq.values()]
      .sort((a, b) => Number(a.seq) - Number(b.seq))
      .slice(-200),
    streamState: "EXACT",
  });
}
