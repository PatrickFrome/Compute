import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";

const data = resolve(process.env.ME2_DATA_DIR ?? "");
const root = resolve(process.env.ME2_RESTART_TEST_ROOT ?? "");
if (!root.includes("metaengine-command-restart-") || !data.startsWith(root + sep)) throw new Error("isolated_restart_test_required");
// The legacy tokens module has an import-time bootstrap from this fixed path.
// This offline fixture must never inspect an existing operator seed directory.
if (existsSync("/home/z/.a2")) throw new Error("operator_seed_directory_present");

const { db, enqueueCommand } = await import("../../store");
const { claimCommand, reconcileOrphanRunningCommands, drainCommands, runOne } = await import("../../commands");
const phase = process.argv[2];
if (phase === "effect-then-crash") {
  const command = enqueueCommand({
    action: "TASK_ENQUEUE", payload: { title: "Restart proof", spec: "Offline database-only test", max_steps: 1 },
    idempotency_key: "restart-proof-effect-key",
  });
  assert.equal(command.ok, true);
  if (!command.ok) throw new Error("enqueue_failed");
  // The real handler commits its task and events. Terminate the incarnation at
  // the exact completion-receipt boundary, before that UPDATE can execute.
  const query = db.query.bind(db);
  db.query = ((sql: string, ...args: unknown[]) => {
    if (sql.startsWith("UPDATE commands SET status='COMPLETED'")) {
      process.stdout.write(JSON.stringify({ phase, command_id: command.command.id }) + "\n");
      process.exit(23);
    }
    return query(sql, ...args);
  }) as typeof db.query;
  await runOne(command.command);
  throw new Error("crash_boundary_not_reached");
}

assert.equal(phase, "recover");
const command = db.query("SELECT * FROM commands WHERE idempotency_key=?").get("restart-proof-effect-key") as Record<string, unknown>;
assert.equal(command.status, "RUNNING");
assert.equal((db.query("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n, 1);
assert.deepEqual(reconcileOrphanRunningCommands(), { ambiguous: 1, automatic_retry_allowed: false });
const recovered = db.query("SELECT * FROM commands WHERE id=?").get(command.id) as Record<string, unknown>;
assert.deepEqual(recovered, { ...command, status: "AMBIGUOUS" });
assert.deepEqual(reconcileOrphanRunningCommands(), { ambiguous: 0, automatic_retry_allowed: false });
assert.equal(await drainCommands(), 0);
assert.equal((db.query("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n, 1);
assert.equal((db.query("SELECT COUNT(*) AS n FROM events WHERE type='COMMAND_EFFECT_UNKNOWN'").get() as { n: number }).n, 1);
assert.equal(claimCommand(String(command.id)), false);

const pending = enqueueCommand({ action: "PING", idempotency_key: "restart-proof-pending-key" });
assert.equal(pending.ok, true);
assert.equal(await drainCommands(), 1);
assert.equal(await drainCommands(), 0);
assert.equal((db.query("SELECT status FROM commands WHERE idempotency_key=?").get("restart-proof-pending-key") as { status: string }).status, "COMPLETED");
db.close();
process.stdout.write(JSON.stringify({ phase, real_handler_effects: 1, replayed_effects: 0, pending_completed_once: true }) + "\n");
