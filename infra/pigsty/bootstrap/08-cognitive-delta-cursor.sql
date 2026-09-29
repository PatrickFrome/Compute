-- ============================================================================
-- 08-cognitive-delta-cursor.sql — локальная реконструкция когнитивного слоя
-- METAENGINE (контур Pigsty 127.0.0.1:55432).
--
-- КОНТРАКТ ВЗЯТ ИЗ ОБЛАКА (аудит 2026-09-21, ref xpeibufgzjknrhbhpffp):
--   * RPC h205f22_a2_browser_cognitive_accept_v1(p_workspace_id uuid,
--       p_client_id text, p_device_id text, p_stream_id uuid,
--       p_after_sequence integer, p_through_sequence integer, p_events jsonb,
--       p_authority_effect boolean) — сигнатура из REST OpenAPI облака.
--   * Хранение = КУРСОРНАЯ таблица compute_fabric_a2_browser_cognitive_cursor_h205f22:
--       workspace_id, client_id, device_id, stream_id,
--       accepted_through_sequence (integer), accepted_batches, accepted_events,
--       first_seen_at, last_seen_at.
--     Сами дельты НЕ персистятся: курсор = watermark реплея,
--     delivery_is_authority=false (каноническое свойство плоскости).
--   * Edge-валидация батча (cognitive-delta-routes.mjs) гарантирует до RPC:
--       schema=batch.v1, through-after == events.length, fence=false,
--       event schema/priority/source/zero-authority — RPC может доверять форме,
--       но дублирует критичные проверки (defense in depth).
--
-- ПРИМЕНЕНИЕ: psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -f this.sql
-- ВАЖНО: после пересоздания командных таблиц миграционным раннером —
--        перевыполнить этот файл (см. урок bootstrap/07).
-- ============================================================================

BEGIN;

-- ── 1. Курсорная таблица (точные колонки облака) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.compute_fabric_a2_browser_cognitive_cursor_h205f22 (
  workspace_id              uuid        NOT NULL,
  client_id                 text        NOT NULL,
  device_id                 text        NOT NULL,
  stream_id                 uuid        NOT NULL,
  accepted_through_sequence integer     NOT NULL DEFAULT 0,
  accepted_batches          integer     NOT NULL DEFAULT 0,
  accepted_events           integer     NOT NULL DEFAULT 0,
  first_seen_at             timestamptz         DEFAULT now(),
  last_seen_at              timestamptz         DEFAULT now(),
  PRIMARY KEY (workspace_id, stream_id, client_id, device_id)
);

COMMENT ON TABLE public.compute_fabric_a2_browser_cognitive_cursor_h205f22 IS
  'METAENGINE cognitive delta cursor (local reconstruction of cloud xpeibufgzjknrhbhpffp). Cursor-only: deltas are not persisted; sequence watermark per (workspace, stream, client, device).';

-- ── 2. Акцептор (SECURITY DEFINER; zero-authority fences) ───────────────────
CREATE OR REPLACE FUNCTION public.h205f22_a2_browser_cognitive_accept_v1(
  p_workspace_id      uuid,
  p_client_id         text,
  p_device_id         text,
  p_stream_id         uuid,
  p_after_sequence    integer,
  p_through_sequence  integer,
  p_events            jsonb,
  p_authority_effect  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_client    text := left(trim(coalesce(p_client_id, '')), 160);
  v_device    text := left(trim(coalesce(p_device_id, '')), 160);
  v_after     integer := coalesce(p_after_sequence, 0);
  v_through   integer := coalesce(p_through_sequence, 0);
  v_events    jsonb := coalesce(p_events, '[]'::jsonb);
  v_count     integer;
  v_stored    integer;
BEGIN
  -- identity / shape fences (edge already validated; duplicate cheaply)
  IF p_workspace_id IS NULL OR v_client = '' OR v_device = '' OR p_stream_id IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'IDENTITY_INVALID',
      'stream_id', p_stream_id, 'accepted_through_sequence', NULL);
  END IF;
  IF p_authority_effect IS NOT FALSE THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'AUTHORITY_EFFECT_FORBIDDEN',
      'stream_id', p_stream_id, 'accepted_through_sequence', NULL);
  END IF;
  IF v_after < 0 OR v_through <= v_after THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'SEQUENCE_RANGE_INVALID',
      'stream_id', p_stream_id, 'accepted_through_sequence', NULL);
  END IF;
  IF jsonb_typeof(v_events) <> 'array' OR (v_through - v_after) <> jsonb_array_length(v_events) THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'EVENT_COUNT_MISMATCH',
      'stream_id', p_stream_id, 'accepted_through_sequence', NULL);
  END IF;
  v_count := jsonb_array_length(v_events);
  IF v_count < 1 OR v_count > 128 THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'EVENT_COUNT_INVALID',
      'stream_id', p_stream_id, 'accepted_through_sequence', NULL);
  END IF;

  -- serialize concurrent batches of the same stream
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_stream_id::text, 0)
  );

  SELECT accepted_through_sequence INTO v_stored
    FROM public.compute_fabric_a2_browser_cognitive_cursor_h205f22
   WHERE workspace_id = p_workspace_id AND stream_id = p_stream_id
     AND client_id = v_client AND device_id = v_device
   FOR UPDATE;

  IF v_stored IS NULL THEN
    IF v_after <> 0 THEN
      RETURN jsonb_build_object('accepted', false, 'reason', 'STREAM_NOT_SEEDED',
        'stream_id', p_stream_id, 'accepted_through_sequence', NULL);
    END IF;
    INSERT INTO public.compute_fabric_a2_browser_cognitive_cursor_h205f22 (
      workspace_id, client_id, device_id, stream_id,
      accepted_through_sequence, accepted_batches, accepted_events,
      first_seen_at, last_seen_at)
    VALUES (p_workspace_id, v_client, v_device, p_stream_id,
      v_through, 1, v_count, now(), now());
  ELSE
    IF v_through <= v_stored THEN
      -- идемпотентный реплей: курсор уже покрывает диапазон — ack без изменений
      RETURN jsonb_build_object('accepted', true, 'reason', 'IDEMPOTENT_REPLAY',
        'stream_id', p_stream_id, 'accepted_through_sequence', v_stored);
    END IF;
    IF v_after > v_stored THEN
      RETURN jsonb_build_object('accepted', false, 'reason', 'SEQUENCE_GAP',
        'stream_id', p_stream_id,
        'accepted_through_sequence', v_stored,
        'expected_after_sequence', v_stored);
    END IF;
    UPDATE public.compute_fabric_a2_browser_cognitive_cursor_h205f22
       SET accepted_through_sequence = v_through,
           accepted_batches = accepted_batches + 1,
           accepted_events  = accepted_events + v_count,
           last_seen_at     = now()
     WHERE workspace_id = p_workspace_id AND stream_id = p_stream_id
       AND client_id = v_client AND device_id = v_device;
  END IF;

  RETURN jsonb_build_object('accepted', true, 'reason', 'OK',
    'stream_id', p_stream_id, 'accepted_through_sequence', v_through,
    'event_count', v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.h205f22_a2_browser_cognitive_accept_v1 FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.h205f22_a2_browser_cognitive_accept_v1 TO postgres, service_role;

COMMIT;
