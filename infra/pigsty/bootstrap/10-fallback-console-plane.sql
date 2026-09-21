-- Fallback Console plane (operator directive 2026-09-21, round FALLBACK-CONSOLE-010).
-- Reserve console embedded in the browser: usable ONLY while Supabase is
-- unresponsive or degraded. Local Pigsty is the durable memory of the reserve
-- authority: every CLOUD_AUTHORITY <-> LOCAL_FALLBACK transition recorded here
-- survives restarts and gives the operator a full outage timeline.

CREATE SCHEMA IF NOT EXISTS destruktion_meta;

CREATE TABLE IF NOT EXISTS destruktion_meta.fallback_console_transition_log_h205f22 (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  from_mode     text NOT NULL,
  to_mode       text NOT NULL,
  reason        text NOT NULL,
  simulated     boolean NOT NULL DEFAULT false,
  cloud_state   text,
  local_state   text
);

COMMENT ON TABLE destruktion_meta.fallback_console_transition_log_h205f22 IS
  'metaengine.fallback-console.v1 — sentinel mode transition audit (browser + mission control)';

CREATE INDEX IF NOT EXISTS fallback_console_transition_log_at_desc_h205f22
  ON destruktion_meta.fallback_console_transition_log_h205f22 (at DESC);
