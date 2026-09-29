// ME2 daemon — SQLite WAL storage schema (versioned in code, applied at boot).
import { Database } from "bun:sqlite";

export const SCHEMA_VERSION = 1;

export function migrate(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'daemon',
      subject TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      prev_hash TEXT NOT NULL DEFAULT '',
      hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      lane TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      payload TEXT NOT NULL DEFAULT '{}',
      result TEXT,
      error TEXT,
      idempotency_key TEXT UNIQUE,
      issued_by TEXT NOT NULL DEFAULT 'operator',
      cost INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      leased_at INTEGER,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'API',
      state TEXT NOT NULL DEFAULT 'REGISTERED',
      generation INTEGER NOT NULL DEFAULT 1,
      task_id TEXT,
      created_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      spec TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'API',
      state TEXT NOT NULL DEFAULT 'READY',
      worker_id TEXT,
      generation INTEGER NOT NULL DEFAULT 1,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);

    -- M5 groundwork: durable evidence mirror (outbox pattern).
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      sent_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox(state);
  `);

  const row = db.query("SELECT value FROM meta WHERE key='schema_version'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    db.query("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION),
    );
  }

  // One-time spec backfill: seeded tasks ship with EARS-style specs so the
  // Mission Control spec view has real content from the first session.
  const backfilled = db.query("SELECT value FROM meta WHERE key='spec_backfill_v1'").get();
  if (!backfilled) {
    const empty = db
      .query("SELECT id, title, role FROM tasks WHERE spec=''")
      .all() as Array<{ id: string; title: string; role: string }>;
    for (const t of empty) {
      db.query("UPDATE tasks SET spec=? WHERE id=?")
        .run(
          [
            `# ${t.title}`,
            ``,
            `Role: ${t.role}`,
            ``,
            `## EARS spec`,
            `- WHEN the task is leased by a worker with role ${t.role}, THE SYSTEM SHALL execute deterministically and record an EFFECT_RESULT.`,
            `- WHEN execution finishes, THE SYSTEM SHALL emit a result artifact URI (me2://artifact/...).`,
            `- IF a lane budget or lease expires, THE SYSTEM SHALL release the task back to READY with generation+1.`,
            ``,
            `## Acceptance`,
            `- result payload contains summary + artifact`,
            `- no unchained side effects (event log stays tamper-evident)`,
            `- latency stays within lane budget (24 units / 60s)`,
          ].join("\n"),
          t.id,
        );
    }
    db.query("INSERT INTO meta (key, value) VALUES ('spec_backfill_v1', '1')").run();
  }
}
