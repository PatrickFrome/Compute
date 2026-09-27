import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEVOS_RECOVERY_DEBT_PRESSURE_SCHEMA,
  probeDevosRecoveryDebtPressure,
  validateDevosRecoveryDebtPressure,
} from '../supabase/a2-browser-native-supervisor-v1/recovery-debt-pressure.mjs';

const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';

function row(overrides = {}) {
  return {
    schema: DEVOS_RECOVERY_DEBT_PRESSURE_SCHEMA,
    workspace_id: workspaceId,
    observed_at: '2026-09-27T10:20:00Z',
    state: 'EFFECT_UNKNOWN_PRESENT',
    ambiguous_total: 72,
    effect_proven_count: 4,
    effect_unknown_count: 68,
    effect_unknown_last_15m: 1,
    effect_unknown_last_60m: 3,
    oldest_effect_unknown_age_seconds: 172800,
    task_content_returned: false,
    physical_effect_replayed: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

test('recovery debt pressure keeps count, age and arrival windows without authority', () => {
  const out = validateDevosRecoveryDebtPressure(row(), { workspaceId });
  assert.equal(out.effect_unknown_count, 68);
  assert.equal(out.effect_unknown_last_15m, 1);
  assert.equal(out.effect_unknown_last_60m, 3);
  assert.equal(out.oldest_effect_unknown_age_seconds, 172800);
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.authority_effect, false);
});

test('clear debt requires zero unknowns and zero oldest age', () => {
  const out = validateDevosRecoveryDebtPressure(row({
    state: 'CLEAR',
    ambiguous_total: 4,
    effect_proven_count: 4,
    effect_unknown_count: 0,
    effect_unknown_last_15m: 0,
    effect_unknown_last_60m: 0,
    oldest_effect_unknown_age_seconds: 0,
  }), { workspaceId });
  assert.equal(out.state, 'CLEAR');
  assert.throws(() => validateDevosRecoveryDebtPressure(row({
    state: 'CLEAR',
    ambiguous_total: 4,
    effect_proven_count: 4,
    effect_unknown_count: 0,
    effect_unknown_last_15m: 0,
    effect_unknown_last_60m: 0,
    oldest_effect_unknown_age_seconds: 5,
  }), { workspaceId }), /oldest_clear_invalid/);
});

test('arrival windows and exact partition are fail-closed', () => {
  assert.throws(() => validateDevosRecoveryDebtPressure(row({ effect_unknown_last_15m: 4, effect_unknown_last_60m: 3 }), { workspaceId }), /window_invalid/);
  assert.throws(() => validateDevosRecoveryDebtPressure(row({ ambiguous_total: 73 }), { workspaceId }), /partition_invalid/);
  assert.throws(() => validateDevosRecoveryDebtPressure(row({ scheduler_authority: true }), { workspaceId }), /authority_invalid/);
});

test('probe requests only the read-only pressure RPC for the exact workspace', async () => {
  const calls = [];
  const out = await probeDevosRecoveryDebtPressure({
    workspaceId,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return row();
    },
  });
  assert.equal(out.effect_unknown_count, 68);
  assert.deepEqual(calls, [{
    name: 'devos_recovery_debt_pressure_v1',
    args: { p_workspace: workspaceId },
  }]);
});

test('migration derives unknown age only from exact task+generation durable proof and exposes no task content', async () => {
  const sql = await readFile(
    new URL('../../../supabase/migrations/20260927102000_devos_recovery_debt_age_observability_v1.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /e\.task_id = a\.task_id/);
  assert.match(sql, /e\.lease_generation = a\.lease_generation/);
  assert.match(sql, /e\.event_type = 'TASK_TRANSPORT_PROVEN'/);
  assert.match(sql, /prompt_sha256/);
  assert.match(sql, /conversation_url_sha256/);
  assert.match(sql, /updated_at >= now\(\) - interval '15 minutes'/);
  assert.match(sql, /updated_at >= now\(\) - interval '60 minutes'/);
  assert.match(sql, /min\(updated_at\) filter \(where not effect_proven\)/);
  assert.match(sql, /'task_content_returned', false/);
  assert.match(sql, /'automatic_retry_allowed', false/);
  assert.match(sql, /'scheduler_authority', false/);
  assert.match(sql, /revoke all on function public\.devos_recovery_debt_pressure_v1\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.devos_recovery_debt_pressure_v1\(uuid\) to service_role/);
});
