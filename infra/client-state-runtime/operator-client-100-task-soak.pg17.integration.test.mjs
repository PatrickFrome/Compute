import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import postgres from 'postgres';
import { startOperatorReadOnlyGateway } from './operator-readonly-gateway.mjs';
import { runOperatorClient100TaskSoak, createLoopbackSoakReader } from './operator-client-100-task-soak.mjs';

// Only CI's named disposable PG17 database is eligible. No production schema,
// writes, migration, admin instance, Browser or Guardian is ever used.
const connection = process.env.LOCAL_STATE_TEST_ADMIN_DATABASE_URL;
const key = 'w34-isolated-staging-key-'.padEnd(64, 'k');
const ownerId = 'w34-staging-owner';
const runId = 'w34-100-task-stage';
const projectId = 'w34-disposable-project';
const stamp = () => new Date().toISOString();
const proof = 'd'.repeat(64);
const meta = () => ({ proven: true, source: 'OWN_POSTGRES_READBACK',
  owner_id: ownerId, owner_epoch: 1, project_id: projectId, run_id: runId, observed_at: stamp() });

function checkedConnection(uri) {
  const u = new URL(uri);
  if (u.protocol !== 'postgres:' || u.hostname !== '127.0.0.1' ||
    u.port !== '5432' || u.pathname !== '/checkpoint_fixture' ||
    u.username !== 'postgres' || u.search || u.hash) throw new Error('w34_disposable_pg_only');
  return uri;
}

test('W34: real local PG17 temporary-only readbacks over existing authenticated Gateway, 100 tasks',
  { skip: !connection && 'requires explicitly provisioned isolated PG17 fixture' }, async () => {
    const sql = postgres(checkedConnection(connection), { max: 1, connect_timeout: 3 });
    let upstream, gateway;
    try {
      await sql.begin(async tx => {
        const [version] = await tx.unsafe('SHOW server_version_num');
        const [dbname] = await tx.unsafe('SELECT current_database() AS name');
        assert(Number(version.server_version_num) >= 170000 && Number(version.server_version_num) < 180000);
        assert.equal(dbname.name, 'checkpoint_fixture');
        await tx.unsafe(`CREATE TEMP TABLE w34_soak_rows (
          event_seq integer PRIMARY KEY, task_id text UNIQUE NOT NULL
        ) ON COMMIT DROP`);
        await tx.unsafe(`INSERT INTO pg_temp.w34_soak_rows (event_seq,task_id)
          SELECT n, 'task-' || lpad(n::text,4,'0') FROM generate_series(1,100) AS n`);
        const owner = { instance_id: ownerId, mode: 'LOCAL_POSTGRES', ok: true };
        const context = () => ({
          schema: 'metaengine.operator.context.v1', storage: 'OWN_POSTGRES_ONLY',
          scope: 'READ_ONLY', authority_effect: false, scheduler_authority: false,
          cloud_database_dependency: false, remote_fallback_allowed: false,
          generated_at: stamp(), planes: {}, private_sql: 'never-expose',
        });
        upstream = createServer((req, res) => {
          if (req.headers.apikey !== key) { res.writeHead(401); res.end(); return; }
          const value = req.url === '/health' ? owner : req.url === '/operator/v1/context' ? context() : null;
          res.writeHead(value ? 200 : 404, { 'content-type': 'application/json' });
          res.end(JSON.stringify(value));
        });
        await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
        gateway = await startOperatorReadOnlyGateway({
          apiKey: key, ownerId, upstreamBaseUrl: 'http://127.0.0.1:' + upstream.address().port,
          readRunIdentity: async () => {
            const [row] = await tx.unsafe('SELECT count(*)::integer AS n, max(event_seq) AS seq FROM pg_temp.w34_soak_rows');
            if (row.n !== 100) return null;
            return { ...meta(), event_seq: row.seq };
          },
          readInspect: async ({ taskId }) => {
            const [row] = await tx.unsafe('SELECT event_seq,task_id FROM pg_temp.w34_soak_rows WHERE task_id = $1', [taskId]);
            return row && { ...meta(), state: 'COMPLETED', task_id: row.task_id, event_seq: row.event_seq };
          },
          readRunStatus: async () => {
            const [row] = await tx.unsafe('SELECT count(*)::integer AS n, max(event_seq) AS seq FROM pg_temp.w34_soak_rows');
            return { ...meta(), state: row.n === 100 ? 'COMPLETED' : 'UNKNOWN', event_seq: row.seq };
          },
          readEvents: async ({ after, limit }) => {
            const rows = await tx.unsafe(`SELECT event_seq,task_id FROM pg_temp.w34_soak_rows
              WHERE event_seq > $1 ORDER BY event_seq LIMIT $2`, [after, limit]);
            return { ...meta(), watermark_event_seq: 100, events: rows.map(row => ({
              event_seq: row.event_seq, task_id: row.task_id, kind: 'TASK_COMPLETED',
              proof_sha256: proof, occurred_at: stamp(),
            })) };
          },
        });
        const read = createLoopbackSoakReader({ baseUrl: gateway.address, apiKey: key });
        const report = await runOperatorClient100TaskSoak({ read });
        assert.equal(report.tasks, 100);
        assert.equal(report.events, 100);
        assert.equal(report.requests, 106);
        assert.equal(report.pass, true);
        assert.equal(report.installed_runtime_proven, false);
        console.log('W34_DISPOSABLE_PG17_SOAK ' + JSON.stringify(report));
      }); // temp table dropped, no persistent mutations
    } finally {
      if (gateway) await gateway.close();
      if (upstream) {
        upstream.closeAllConnections();
        await new Promise(resolve => upstream.close(resolve));
      }
      await sql.end({ timeout: 3 });
    }
  });
