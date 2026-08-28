\set ON_ERROR_STOP on
BEGIN READ ONLY;

WITH table_targets(table_name) AS (
  VALUES
    ('compute_fabric_w1_callback_key_h205f22'::text),
    ('compute_fabric_w1_execution_callback_receipt_h205f22'::text)
), table_state AS (
  SELECT
    t.table_name,
    c.oid,
    n.nspname AS schema_name,
    c.relrowsecurity,
    c.relowner,
    c.relacl
  FROM table_targets t
  LEFT JOIN pg_class c
    ON c.relname = t.table_name
   AND c.relkind IN ('r','p')
   AND c.relnamespace = 'public'::regnamespace
  LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
), table_payload AS (
  SELECT
    s.table_name,
    jsonb_build_object(
      'present', s.oid IS NOT NULL AND s.schema_name = 'public',
      'schema', CASE WHEN s.oid IS NULL THEN NULL ELSE s.schema_name END,
      'rls_enabled', COALESCE(s.relrowsecurity, false),
      'privileges', jsonb_build_object(
        'public', COALESCE((
          SELECT jsonb_agg(a.privilege_type ORDER BY a.privilege_type)
          FROM aclexplode(COALESCE(s.relacl, acldefault('r', s.relowner))) AS a
          WHERE a.grantee = 0
        ), '[]'::jsonb),
        'anon', COALESCE((
          SELECT jsonb_agg(p ORDER BY p)
          FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]) AS p
          WHERE s.oid IS NOT NULL
            AND to_regrole('anon') IS NOT NULL
            AND has_table_privilege('anon', s.oid, p)
        ), '[]'::jsonb),
        'authenticated', COALESCE((
          SELECT jsonb_agg(p ORDER BY p)
          FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]) AS p
          WHERE s.oid IS NOT NULL
            AND to_regrole('authenticated') IS NOT NULL
            AND has_table_privilege('authenticated', s.oid, p)
        ), '[]'::jsonb),
        'service_role', COALESCE((
          SELECT jsonb_agg(p ORDER BY p)
          FROM unnest(ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]) AS p
          WHERE s.oid IS NOT NULL
            AND to_regrole('service_role') IS NOT NULL
            AND has_table_privilege('service_role', s.oid, p)
        ), '[]'::jsonb)
      ),
      'service_role_column_updates', COALESCE((
        SELECT jsonb_agg(cols.column_name ORDER BY cols.ordinal_position)
        FROM information_schema.columns cols
        WHERE cols.table_schema = 'public'
          AND cols.table_name = s.table_name
          AND to_regrole('service_role') IS NOT NULL
          AND has_column_privilege(
                'service_role',
                format('%I.%I', cols.table_schema, cols.table_name),
                cols.column_name,
                'UPDATE'
              )
      ), '[]'::jsonb)
    ) AS payload
  FROM table_state s
), function_targets(label, identity) AS (
  VALUES
    ('register_key'::text, 'compute_fabric_register_w1_callback_key_h205f22(jsonb)'::text),
    ('revoke_key'::text, 'compute_fabric_revoke_w1_callback_key_h205f22(text,timestamp with time zone)'::text),
    ('get_key'::text, 'compute_fabric_get_w1_callback_key_h205f22(text)'::text),
    ('record_callback'::text, 'compute_fabric_record_w1_execution_callback_h205f22(jsonb)'::text)
), function_state AS (
  SELECT
    f.label,
    f.identity,
    p.oid,
    n.nspname AS schema_name,
    p.prosecdef,
    p.proowner,
    p.proacl
  FROM function_targets f
  LEFT JOIN LATERAL (
    SELECT to_regprocedure('public.' || f.identity) AS oid
  ) r ON true
  LEFT JOIN pg_proc p ON p.oid = r.oid
  LEFT JOIN pg_namespace n ON n.oid = p.pronamespace
), function_payload AS (
  SELECT
    s.label,
    jsonb_build_object(
      'present', s.oid IS NOT NULL AND s.schema_name = 'public',
      'schema', CASE WHEN s.oid IS NULL THEN NULL ELSE s.schema_name END,
      'identity', s.identity,
      'security_definer', COALESCE(s.prosecdef, false),
      'execute', jsonb_build_object(
        'public', COALESCE((
          SELECT bool_or(a.privilege_type = 'EXECUTE')
          FROM aclexplode(COALESCE(s.proacl, acldefault('f', s.proowner))) AS a
          WHERE a.grantee = 0
        ), false),
        'anon', COALESCE(s.oid IS NOT NULL AND to_regrole('anon') IS NOT NULL
                         AND has_function_privilege('anon', s.oid, 'EXECUTE'), false),
        'authenticated', COALESCE(s.oid IS NOT NULL AND to_regrole('authenticated') IS NOT NULL
                                  AND has_function_privilege('authenticated', s.oid, 'EXECUTE'), false),
        'service_role', COALESCE(s.oid IS NOT NULL AND to_regrole('service_role') IS NOT NULL
                                 AND has_function_privilege('service_role', s.oid, 'EXECUTE'), false)
      )
    ) AS payload
  FROM function_state s
)
SELECT jsonb_build_object(
  'provenance_class', 'PROTECTED_SUPABASE_SQL_READBACK',
  'observed_at', to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'tables', (SELECT jsonb_object_agg(table_name, payload ORDER BY table_name) FROM table_payload),
  'functions', (SELECT jsonb_object_agg(label, payload ORDER BY label) FROM function_payload)
)::text;

COMMIT;
