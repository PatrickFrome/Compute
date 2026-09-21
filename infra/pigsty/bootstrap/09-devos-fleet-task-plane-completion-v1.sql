-- ============================================================================
-- METAENGINE reconstruction 2026-09-21 (часть 9) — DevOS task plane completion.
--
-- Закрывает незаконченные места локальной реконструкции, найденные
-- критическим аудитом раунда DEEP-AUDIT-SYNTH-20260921-008:
--   * devos_fleet_snapshot_v1        — ОТСУТСТВОВАЛА (edge cycle 500)
--   * devos_fleet_lease_legacy_h205f22 — стаб RETURNS void (lease_v1 падал)
--   * devos_fleet_mark_running_v1    — ОТСУТСТВОВАЛА
--   * devos_fleet_complete_v1        — ОТСУТСТВОВАЛА
--   * devos_fleet_enqueue_legacy_admission_h205f22 — стаб (enqueue ничего не писал)
--   * devos_fleet_enqueue_v1         — перекошенный маппинг аргументов
--                                      (base→task_class, key→base, priority→max_claims)
--   * devos_fleet_reconcile_v1 ссылался на несуществующие
--     destruktion_meta.devos_emit_event_h205f22() и колонку idempotency_key
--   * claim-таблице не хватало 7 колонок (task_id/point_id/lease_generation/
--     base_sha/claim_class/expires_at/updated_at), referenced by reconcile
--
-- Канонические контракты взяты из consumers edge (devos-routes.mjs рельсы
-- 6bf173c7): backlogOf/roleSchedulingStats/fairIdleLeaseCandidates/
-- runningForAgents ждут snapshot {active_tasks, active_claims, recent_events};
-- mark-running ждёт proof {prompt_sha256, conversation_url_sha256, effect_state};
-- complete ждёт FINALISH ∈ {RESULT_READY, BLOCKED, AMBIGUOUS, COMPLETED, FAILED}.
-- State-машина: QUEUED → READY → LEASED → RUNNING → FINALISH; reconcile
-- переводит истёкшие LEASED/RUNNING в AMBIGUOUS (LEASE_EXPIRED_EFFECT_UNKNOWN).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Схема: недостающие колонки + индексы
-- ---------------------------------------------------------------------------
-- канонический uuid-default (реконструкция создала таблицу без default)
ALTER TABLE destruktion_meta.devos_fleet_task_h205f22
  ALTER COLUMN task_id SET DEFAULT gen_random_uuid();

ALTER TABLE destruktion_meta.devos_fleet_task_h205f22
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS devos_fleet_task_ws_idem_uq_v9
  ON destruktion_meta.devos_fleet_task_h205f22 (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS devos_fleet_task_ready_pick_idx_v9
  ON destruktion_meta.devos_fleet_task_h205f22 (workspace_id, role, priority, created_at)
  WHERE state = 'READY';

ALTER TABLE destruktion_meta.devos_fleet_claim_h205f22
  ADD COLUMN IF NOT EXISTS task_id uuid;
ALTER TABLE destruktion_meta.devos_fleet_claim_h205f22
  ADD COLUMN IF NOT EXISTS point_id text;
ALTER TABLE destruktion_meta.devos_fleet_claim_h205f22
  ADD COLUMN IF NOT EXISTS lease_generation bigint;
ALTER TABLE destruktion_meta.devos_fleet_claim_h205f22
  ADD COLUMN IF NOT EXISTS base_sha text;
ALTER TABLE destruktion_meta.devos_fleet_claim_h205f22
  ADD COLUMN IF NOT EXISTS claim_class text;
ALTER TABLE destruktion_meta.devos_fleet_claim_h205f22
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE destruktion_meta.devos_fleet_claim_h205f22
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

-- канонический инвариант: один активный claim на агента (workspace)
CREATE UNIQUE INDEX IF NOT EXISTS devos_fleet_claim_agent_active_uq_v9
  ON destruktion_meta.devos_fleet_claim_h205f22 (workspace_id, agent_id)
  WHERE state = 'ACTIVE';

-- runtime-control seeding (lease_v1/enqueue_v1 требуют каноническую строку;
-- default-политика: admission открыт, refill включён, floor=0)
INSERT INTO destruktion_meta.devos_fleet_runtime_control_h205f22
  (workspace_id, generation_floor, refill_enabled, supervisor_admission_enabled, authority_effect)
VALUES ('2de9f84b-7c0a-4091-911c-894ff1d6eaf4', 0, true, true, false)
ON CONFLICT (workspace_id) DO NOTHING;

ALTER TABLE destruktion_meta.devos_fleet_event_h205f22
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS devos_fleet_event_idem_uq_v9
  ON destruktion_meta.devos_fleet_event_h205f22 (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Хелпер событий (сигнатура ровно та, что дергает reconcile_v1)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION destruktion_meta.devos_emit_event_h205f22(
  p_workspace uuid,
  p_event_type text,
  p_task_id uuid,
  p_point_id text,
  p_role text,
  p_agent text,
  p_lease_generation bigint,
  p_base_sha text,
  p_payload jsonb,
  p_idempotency_key text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'destruktion_meta'
AS $function$
declare
  v_event_id bigint;
begin
  insert into destruktion_meta.devos_fleet_event_h205f22
    (workspace_id, task_id, lease_generation, event_type, payload, authority_effect, idempotency_key)
  values (
    p_workspace,
    p_task_id,
    p_lease_generation,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb)
      || jsonb_build_object(
        'point_id', p_point_id,
        'role', p_role,
        'agent_id', p_agent,
        'base_sha', p_base_sha
      ),
    false,
    p_idempotency_key
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning event_id into v_event_id;
  return v_event_id;
end
$function$;

-- ---------------------------------------------------------------------------
-- 3. devos_fleet_snapshot_v1 — contract по потребителям edge
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devos_fleet_snapshot_v1(p_workspace uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'destruktion_meta'
AS $function$
  select jsonb_build_object(
    'schema', 'metaengine.devos.fleet-snapshot.v1',
    'workspace_id', p_workspace,
    'authority_effect', false,
    'automatic_retry_allowed', false,
    'active_tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'task_id', t.task_id,
        'workspace_id', t.workspace_id,
        'point_id', t.point_id,
        'claim_class', t.claim_class,
        'base_sha', t.base_sha,
        'branch_name', t.branch_name,
        'state', t.state,
        'lease_generation', t.lease_generation,
        'lease_agent_id', t.lease_agent_id,
        'lease_tab_id', t.lease_tab_id,
        'lease_target_id', t.lease_target_id,
        'lease_agent_generation_epoch', t.lease_agent_generation_epoch,
        'lease_expires_at', t.lease_expires_at,
        'role', upper(t.role),
        'priority', t.priority,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      ) order by t.priority asc nulls last, t.created_at asc)
      from destruktion_meta.devos_fleet_task_h205f22 t
      where t.workspace_id = p_workspace
        and t.state in ('READY', 'LEASED', 'RUNNING')
    ), '[]'::jsonb),
    'active_claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claim_id', c.claim_id,
        'workspace_id', c.workspace_id,
        'task_id', c.task_id,
        'point_id', c.point_id,
        'role', upper(c.role),
        'agent_id', c.agent_id,
        'tab_id', c.tab_id,
        'target_id', c.target_id,
        'agent_generation_epoch', c.agent_generation_epoch,
        'lease_generation', c.lease_generation,
        'base_sha', c.base_sha,
        'claim_class', c.claim_class,
        'state', c.state,
        'expires_at', c.expires_at
      ) order by c.claim_id)
      from destruktion_meta.devos_fleet_claim_h205f22 c
      where c.workspace_id = p_workspace
        and c.state = 'ACTIVE'
    ), '[]'::jsonb),
    'recent_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id', e.event_id,
        'event_type', e.event_type,
        'task_id', e.task_id,
        'lease_generation', e.lease_generation,
        'payload', e.payload,
        'created_at', e.created_at
      ) order by e.event_id desc)
      from (
        select * from destruktion_meta.devos_fleet_event_h205f22
        where workspace_id = p_workspace
        order by event_id desc
        limit 50
      ) e
    ), '[]'::jsonb)
  )
$function$;

-- ---------------------------------------------------------------------------
-- 4. Реальный лизинг вместо void-стаба (сигнатура позиций сохранена)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.devos_fleet_lease_legacy_h205f22(uuid, text, text, text, text, bigint, integer);

CREATE OR REPLACE FUNCTION public.devos_fleet_lease_legacy_h205f22(
  p_workspace uuid,
  p_agent text,
  p_role text,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'destruktion_meta'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, least(3600, coalesce(p_seconds, 900)));
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_existing_claim record;
begin
  if p_workspace is null or p_agent is null or p_role is null then
    return jsonb_build_object('leased', false, 'reason', 'DEVOS_LEASE_INPUT_REQUIRED',
      'automatic_retry_allowed', false, 'authority_effect', false);
  end if;

  -- канонический инвариант: один активный claim на агента
  select c.claim_id, c.task_id into v_existing_claim
    from destruktion_meta.devos_fleet_claim_h205f22 c
   where c.workspace_id = p_workspace
     and c.agent_id = lower(p_agent)
     and c.state = 'ACTIVE'
   limit 1;
  if found then
    return jsonb_build_object(
      'leased', false, 'agent_id', lower(p_agent), 'role', upper(p_role),
      'reason', 'AGENT_ACTIVE_CLAIM_EXISTS', 'claim_id', v_existing_claim.claim_id,
      'held_task_id', v_existing_claim.task_id,
      'automatic_retry_allowed', false, 'authority_effect', false
    );
  end if;

  -- role-fair выбор READY-задачи: priority asc, FIFO.
  -- ВАЖНО (PG-ловушка, найдена верификацией): self-referential
  -- UPDATE...FROM (select ... for update skip locked limit 1) выполняет
  -- volatile-подзапрос по разу на каждую внешнюю строку (nested loop) и
  -- SKIP LOCKED отдаёт на каждой итерации РАЗНУЮ задачу → UPDATE цепляет
  -- несколько строк. Канонический паттерн: сначала SELECT ... FOR UPDATE
  -- в переменную, затем UPDATE по точному PK + CAS.
  select t.* into v_task
    from destruktion_meta.devos_fleet_task_h205f22 t
   where t.workspace_id = p_workspace
     and t.state = 'READY'
     and upper(t.role) = upper(p_role)
   order by t.priority asc nulls last, t.created_at asc
   for update skip locked
   limit 1;

  if not found then
    return jsonb_build_object(
      'leased', false, 'agent_id', lower(p_agent), 'role', upper(p_role),
      'reason', 'NO_READY_TASK_FOR_ROLE',
      'automatic_retry_allowed', false, 'authority_effect', false
    );
  end if;

  update destruktion_meta.devos_fleet_task_h205f22 t
     set state = 'LEASED',
         lease_generation = t.lease_generation + 1,
         lease_agent_id = lower(p_agent),
         lease_tab_id = p_tab,
         lease_target_id = lower(p_target),
         lease_agent_generation_epoch = p_epoch,
         lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
         updated_at = v_now
   where t.task_id = v_task.task_id
     and t.state = 'READY'
   returning t.* into v_task;

  if not found then
    return jsonb_build_object(
      'leased', false, 'agent_id', lower(p_agent), 'role', upper(p_role),
      'reason', 'NO_READY_TASK_FOR_ROLE',
      'automatic_retry_allowed', false, 'authority_effect', false
    );
  end if;

  insert into destruktion_meta.devos_fleet_claim_h205f22
    (workspace_id, role, agent_id, tab_id, target_id, agent_generation_epoch,
     state, task_id, point_id, lease_generation, base_sha, claim_class, expires_at)
  values
    (p_workspace, upper(p_role), lower(p_agent), p_tab, lower(p_target), p_epoch,
     'ACTIVE', v_task.task_id, v_task.point_id, v_task.lease_generation,
     v_task.base_sha, v_task.claim_class, v_task.lease_expires_at)
  on conflict do nothing;

  perform destruktion_meta.devos_emit_event_h205f22(
    p_workspace,
    'TASK_LEASED',
    v_task.task_id,
    v_task.point_id,
    upper(p_role),
    lower(p_agent),
    v_task.lease_generation,
    v_task.base_sha,
    jsonb_build_object(
      'tab_id', p_tab,
      'target_id', lower(p_target),
      'agent_generation_epoch', p_epoch,
      'claim_class', v_task.claim_class,
      'lease_expires_at', v_task.lease_expires_at,
      'automatic_retry_allowed', false,
      'authority_effect', false
    ),
    'devos:leased:' || v_task.task_id || ':' || v_task.lease_generation
  );

  return jsonb_build_object(
    'leased', true,
    'task_id', v_task.task_id,
    'agent_id', lower(p_agent),
    'role', upper(p_role),
    'point_id', v_task.point_id,
    'base_sha', v_task.base_sha,
    'branch_name', v_task.branch_name,
    'lease_generation', v_task.lease_generation,
    'tab_id', p_tab,
    'target_id', lower(p_target),
    'agent_generation_epoch', p_epoch,
    'lease_expires_at', v_task.lease_expires_at,
    'task_spec', v_task.task_spec,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- 5. devos_fleet_mark_running_v1 — двойное proof-доказательство, CAS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devos_fleet_mark_running_v1(
  p_task uuid,
  p_agent text,
  p_generation bigint,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_proof jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'destruktion_meta'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
begin
  update destruktion_meta.devos_fleet_task_h205f22 t
     set state = 'RUNNING',
         result_summary = jsonb_build_object('proof', p_proof),
         updated_at = v_now
   where t.task_id = p_task
     and t.state = 'LEASED'
     and t.lease_agent_id = lower(p_agent)
     and t.lease_generation = p_generation
     and t.lease_tab_id = p_tab
     and t.lease_target_id = lower(p_target)
     and t.lease_agent_generation_epoch = p_epoch
   returning t.* into v_task;

  if not found then
    return jsonb_build_object(
      'accepted', false, 'task_id', p_task, 'reason', 'LEASE_BINDING_MISMATCH',
      'automatic_retry_allowed', false, 'authority_effect', false
    );
  end if;

  perform destruktion_meta.devos_emit_event_h205f22(
    v_task.workspace_id,
    'TASK_MARK_RUNNING',
    v_task.task_id,
    v_task.point_id,
    v_task.role,
    lower(p_agent),
    v_task.lease_generation,
    v_task.base_sha,
    jsonb_build_object(
      'effect_state', coalesce(p_proof ->> 'effect_state', 'PROVEN_GENERATING'),
      'prompt_sha256', p_proof ->> 'prompt_sha256',
      'conversation_url_sha256', p_proof ->> 'conversation_url_sha256',
      'automatic_retry_allowed', false,
      'authority_effect', false
    ),
    'devos:mark-running:' || v_task.task_id || ':' || v_task.lease_generation
  );

  return jsonb_build_object(
    'accepted', true,
    'task_id', v_task.task_id,
    'state', 'RUNNING',
    'lease_generation', v_task.lease_generation,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- 6. devos_fleet_complete_v1 — финализация + закрытие claim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devos_fleet_complete_v1(
  p_task uuid,
  p_agent text,
  p_generation bigint,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_state text,
  p_summary jsonb,
  p_error text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'destruktion_meta'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_final constant text[] := array['RESULT_READY', 'BLOCKED', 'AMBIGUOUS', 'COMPLETED', 'FAILED'];
  v_state text := upper(coalesce(p_state, ''));
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_event_type text;
begin
  if not (v_state = any (v_final)) then
    return jsonb_build_object(
      'accepted', false, 'task_id', p_task, 'reason', 'FINAL_STATE_INVALID',
      'automatic_retry_allowed', false, 'authority_effect', false
    );
  end if;

  update destruktion_meta.devos_fleet_task_h205f22 t
     set state = v_state,
         result_summary = coalesce(p_summary, '{}'::jsonb),
         error_code = nullif(btrim(coalesce(p_error, '')), ''),
         finished_at = v_now,
         updated_at = v_now
   where t.task_id = p_task
     and t.state in ('LEASED', 'RUNNING')
     and t.lease_agent_id = lower(p_agent)
     and t.lease_generation = p_generation
     and t.lease_tab_id = p_tab
     and t.lease_target_id = lower(p_target)
     and t.lease_agent_generation_epoch = p_epoch
   returning t.* into v_task;

  if not found then
    return jsonb_build_object(
      'accepted', false, 'task_id', p_task, 'reason', 'LEASE_BINDING_MISMATCH',
      'automatic_retry_allowed', false, 'authority_effect', false
    );
  end if;

  update destruktion_meta.devos_fleet_claim_h205f22 c
     set state = 'CLOSED',
         updated_at = v_now
   where c.task_id = v_task.task_id
     and c.agent_id = lower(p_agent)
     and c.lease_generation = v_task.lease_generation
     and c.state = 'ACTIVE';

  v_event_type := case v_state
    when 'COMPLETED' then 'TASK_COMPLETED'
    when 'RESULT_READY' then 'TASK_RESULT_READY'
    when 'FAILED' then 'TASK_FAILED'
    when 'BLOCKED' then 'TASK_BLOCKED'
    else 'TASK_AMBIGUOUS'
  end;

  perform destruktion_meta.devos_emit_event_h205f22(
    v_task.workspace_id,
    v_event_type,
    v_task.task_id,
    v_task.point_id,
    v_task.role,
    lower(p_agent),
    v_task.lease_generation,
    v_task.base_sha,
    jsonb_build_object(
      'final_state', v_state,
      'error_code', nullif(btrim(coalesce(p_error, '')), ''),
      'summary_keys', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_object_keys(coalesce(p_summary, '{}'::jsonb)) as k(key)),
      'automatic_retry_allowed', false,
      'authority_effect', false
    ),
    'devos:complete:' || v_task.task_id || ':' || v_task.lease_generation
  );

  return jsonb_build_object(
    'accepted', true,
    'task_id', v_task.task_id,
    'state', v_state,
    'lease_generation', v_task.lease_generation,
    'finished_at', v_task.finished_at,
    'readback', jsonb_build_object('task_id', v_task.task_id, 'state', v_state),
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- 7. Реальная enqueue-admission вместо стаба
--    (workspace, point, role, task_class→claim_class, payload→spec,
--     base→base_sha, branch, max_claims)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devos_fleet_enqueue_legacy_admission_h205f22(
  p_workspace uuid,
  p_point text,
  p_role text,
  p_task_class text,
  p_payload jsonb,
  p_base text,
  p_branch text,
  p_max_claims integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'destruktion_meta'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_spec jsonb := coalesce(p_payload, '{}'::jsonb);
  v_claim_class text := coalesce(nullif(btrim(coalesce(p_task_class, '')), ''), 'TASK');
  v_priority integer := coalesce((v_spec ->> 'priority')::int, 50);
  v_state text;
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_admission record;
begin
  if p_workspace is null or nullif(btrim(coalesce(p_point, '')), '') is null
     or nullif(btrim(coalesce(p_role, '')), '') is null then
    raise exception 'devos_enqueue_input_required' using errcode = '22023';
  end if;

  select coalesce(c.supervisor_admission_enabled, true) as admission_enabled
    into v_admission
    from (select 1) one
    left join destruktion_meta.devos_fleet_runtime_control_h205f22 c
      on c.workspace_id = p_workspace;

  -- admission-fence: при закрытом admission задача копится в QUEUED,
  -- reconcile/оператор открывают fence — задача стартует без потери работы
  v_state := case when v_admission.admission_enabled then 'READY' else 'QUEUED' end;

  insert into destruktion_meta.devos_fleet_task_h205f22
    (workspace_id, point_id, claim_class, base_sha, branch_name, state,
     lease_generation, authority_effect, role, task_spec, priority, idempotency_key)
  values
    (p_workspace, btrim(p_point), upper(v_claim_class),
     nullif(btrim(coalesce(p_base, '')), ''),
     nullif(btrim(coalesce(p_branch, '')), ''),
     v_state, 0, false, upper(btrim(p_role)),
     v_spec || jsonb_build_object('max_claims', coalesce(p_max_claims, 1)),
     coalesce(v_priority, 50),
     nullif(btrim(coalesce(v_spec ->> 'enqueue_key', '')), ''))
  on conflict (workspace_id, idempotency_key) where idempotency_key is not null do nothing
  returning * into v_task;

  if v_task.task_id is null then
    -- идемпотентный повтор: вернуть существующую задачу
    select * into v_task
      from destruktion_meta.devos_fleet_task_h205f22
     where workspace_id = p_workspace
       and idempotency_key = nullif(btrim(coalesce(v_spec ->> 'enqueue_key', '')), '')
     limit 1;
    perform destruktion_meta.devos_emit_event_h205f22(
      p_workspace, 'TASK_ENQUEUE_DUPLICATE', v_task.task_id, v_task.point_id,
      v_task.role, null, v_task.lease_generation, v_task.base_sha,
      jsonb_build_object('enqueue_key', v_spec ->> 'enqueue_key',
        'automatic_retry_allowed', false, 'authority_effect', false),
      null
    );
    return;
  end if;

  perform destruktion_meta.devos_emit_event_h205f22(
    p_workspace,
    'TASK_ENQUEUED',
    v_task.task_id,
    v_task.point_id,
    v_task.role,
    null,
    0,
    v_task.base_sha,
    jsonb_build_object(
      'claim_class', v_task.claim_class,
      'priority', v_task.priority,
      'initial_state', v_state,
      'enqueue_key', v_spec ->> 'enqueue_key',
      'automatic_retry_allowed', false,
      'authority_effect', false
    ),
    'devos:enqueued:' || v_task.task_id
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- 8. Фикс перекошенного маппинга enqueue_v1 (сохраняя каноническую сигнатуру)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.devos_fleet_enqueue_v1(
  p_workspace uuid,
  p_point text,
  p_role text,
  p_base text,
  p_spec jsonb,
  p_key text,
  p_branch text DEFAULT NULL::text,
  p_priority integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'destruktion_meta'
AS $function$
declare
  v_control destruktion_meta.devos_fleet_runtime_control_h205f22%rowtype;
  v_continuous boolean := coalesce(p_spec ->> 'continuous_role', 'false') = 'true';
  v_spec_full jsonb;
  v_claim_class text;
  v_existing uuid;
begin
  if v_continuous then
    select * into v_control
      from destruktion_meta.devos_fleet_runtime_control_h205f22
     where workspace_id = p_workspace;
    if not found then
      return jsonb_build_object(
        'accepted', false, 'enqueued', false, 'reason', 'RUNTIME_CONTROL_MISSING',
        'workspace_id', p_workspace, 'automatic_retry_allowed', false, 'authority_effect', false
      );
    end if;
    if not v_control.refill_enabled or not v_control.supervisor_admission_enabled then
      return jsonb_build_object(
        'accepted', false, 'enqueued', false, 'reason', 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
        'workspace_id', p_workspace,
        'generation_floor', v_control.generation_floor,
        'refill_enabled', v_control.refill_enabled,
        'supervisor_admission_enabled', v_control.supervisor_admission_enabled,
        'automatic_retry_allowed', false, 'authority_effect', false
      );
    end if;
  end if;

  v_spec_full := coalesce(p_spec, '{}'::jsonb)
    || jsonb_build_object('enqueue_key', p_key, 'priority', coalesce(p_priority, 50));
  v_claim_class := coalesce(nullif(btrim(coalesce(p_spec ->> 'claim_class', '')), ''), 'TASK');

  begin
    perform public.devos_fleet_enqueue_legacy_admission_h205f22(
      p_workspace, p_point, p_role, v_claim_class, v_spec_full,
      p_base, p_branch, 1
    );
  exception
    when others then
      return jsonb_build_object(
        'accepted', false, 'enqueued', false,
        'reason', 'ENQUEUE_ADMISSION_REJECTED',
        'detail', left(SQLERRM, 160),
        'workspace_id', p_workspace,
        'automatic_retry_allowed', false, 'authority_effect', false
      );
  end;

  select t.task_id into v_existing
    from destruktion_meta.devos_fleet_task_h205f22 t
   where t.workspace_id = p_workspace
     and t.idempotency_key = nullif(btrim(coalesce(p_key, '')), '')
   order by t.created_at desc
   limit 1;

  return jsonb_build_object(
    'accepted', true,
    'enqueued', true,
    'task_id', v_existing,
    'point_id', p_point,
    'role', upper(btrim(p_role)),
    'claim_class', v_claim_class,
    'priority', coalesce(p_priority, 50),
    'base_sha', nullif(btrim(coalesce(p_base, '')), ''),
    'workspace_id', p_workspace,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$function$;

COMMIT;
