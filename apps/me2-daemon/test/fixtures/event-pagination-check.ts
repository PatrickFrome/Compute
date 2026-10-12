import assert from "node:assert/strict";
import * as store from "../../store";

const a1 = store.emit("TASK_STARTED", { step: 1 }, "agent-a", "task-a");
const b1 = store.emit("TASK_STARTED", { step: 1 }, "agent-b", "task-b");
const a2 = store.emit("TOOL_RESULT", { step: 2 }, "agent-c", "task-a");
const b2 = store.emit("TOOL_RESULT", { step: 2 }, "agent-b", "task-b");
const a3 = store.emit("TASK_COMPLETED", { step: 3 }, "agent-a", "task-a");
const b3 = store.emit("TASK_COMPLETED", { step: 3 }, "agent-b", "task-b");
const seqs = (page: ReturnType<typeof store.readEventPage>) => page.events.map((row) => row.seq);
let checks = 0;

// Initial task read is the newest window, displayed chronologically.
const latest = store.readEventPage({ taskId: "task-a", limit: 2 });
assert.deepEqual(seqs(latest), [a2.seq, a3.seq]);
assert.deepEqual(latest.events.map((row) => row.agent_id), ["agent-c", "agent-a"]);
assert.deepEqual(latest.scope, { kind: "task", task_id: "task-a" });
assert.deepEqual(latest.cursor, { mode: "latest", after_seq: null, returned_through_seq: a3.seq,
  latest_seq: a3.seq, log_latest_seq: b3.seq, has_more: false, has_earlier: true,
  resync_required: false, resync_reason: null });
assert.equal(latest.project_history_available, false);
assert.equal(latest.authority_effect, false);
checks++;

// Explicit cursor pages cannot omit a task row or include another task.
const first = store.readEventPage({ taskId: "task-a", since: 0, limit: 2 });
assert.deepEqual(seqs(first), [a1.seq, a2.seq]);
assert.equal(first.cursor.has_more, true);
const second = store.readEventPage({ taskId: "task-a", since: first.cursor.returned_through_seq, limit: 2 });
assert.deepEqual(seqs(second), [a3.seq]);
assert.equal(second.cursor.has_more, false);
assert.equal(second.cursor.resync_required, false);
checks++;

// Other tasks legitimately cause sequence gaps and advance the global cursor.
assert.deepEqual(seqs(store.readEventPage({ taskId: "task-a", since: b2.seq })), [a3.seq]);
const quiet = store.readEventPage({ taskId: "task-a", since: b3.seq });
assert.deepEqual(quiet.events, []);
assert.equal(quiet.cursor.returned_through_seq, b3.seq);
assert.equal(quiet.cursor.resync_required, false);
checks++;

const global = store.readEventPage({ since: a1.seq, limit: 2 });
assert.deepEqual(seqs(global), [b1.seq, a2.seq]);
assert.equal(global.cursor.has_more, true);
assert.deepEqual(global.scope, { kind: "global", task_id: null });
checks++;

const ahead = store.readEventPage({ taskId: "task-a", since: b3.seq + 1 });
assert.deepEqual(ahead.events, []);
assert.equal(ahead.cursor.resync_required, true);
assert.equal(ahead.cursor.resync_reason, "CURSOR_AHEAD_OF_LOG");
assert.equal(ahead.cursor.returned_through_seq, b3.seq + 1);
checks++;

const empty = store.readEventPage({ taskId: "task-missing" });
assert.deepEqual(empty.events, []);
assert.equal(empty.cursor.latest_seq, 0);
assert.equal(empty.cursor.resync_required, false);
assert.equal(empty.project_history_available, false);
checks++;

for (const since of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => store.readEventPage({ since }), /event_cursor_invalid/);
}
for (const limit of [0, -1, 0.5, 501, Infinity]) {
  assert.throws(() => store.readEventPage({ limit }), /event_limit_invalid/);
}
for (const taskId of ["", "a".repeat(193), "task\nforeign"]) {
  assert.throws(() => store.readEventPage({ taskId }), /event_task_id_invalid/);
}
checks++;

const before = store.tailEvents(0, 500);
const once = store.readEventPage({ taskId: "task-a", since: a1.seq, limit: 2 });
assert.deepEqual(store.readEventPage({ taskId: "task-a", since: a1.seq, limit: 2 }), once);
assert.deepEqual(store.tailEvents(0, 500), before);
checks++;
store.db.close();
process.stdout.write(JSON.stringify({ checks }));
