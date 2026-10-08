-- Apply as the trusted local PostgreSQL administrator, after pgcrypto in extensions.
-- This provider uses pgcrypto PGP, not the unavailable Supabase AEAD root key.
CREATE SCHEMA IF NOT EXISTS vault;

DO $check$
BEGIN
  IF pg_catalog.to_regprocedure('extensions.pgp_sym_encrypt_bytea(bytea,text,text)') IS NULL THEN
    RAISE EXCEPTION 'local_vault_pgcrypto_required';
  END IF;
END;
$check$;

CREATE OR REPLACE FUNCTION vault._local_key()
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  key_text text;
BEGIN
  key_text := pg_catalog.btrim(pg_catalog.pg_read_file('client-vault.key', 0, 128, true), E' \t\r\n');
  IF key_text IS NULL OR key_text !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'local_vault_private_key_unavailable' USING ERRCODE = '55000';
  END IF;
  RETURN key_text;
END;
$function$;

CREATE OR REPLACE FUNCTION vault._crypto_aead_det_noncegen()
RETURNS bytea
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT extensions.gen_random_bytes(24)
$function$;

CREATE OR REPLACE FUNCTION vault._crypto_aead_det_encrypt(
  message bytea, additional bytea, key_id bigint,
  context bytea DEFAULT 'pgsodium', nonce bytea DEFAULT NULL
)
RETURNS bytea
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  envelope bytea;
BEGIN
  IF message IS NULL THEN RETURN NULL; END IF;
  IF key_id IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'local_vault_key_id_unsupported' USING ERRCODE = '22023';
  END IF;
  envelope := pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'schema', 'compute.local-vault.pgcrypto.v1',
    'message', pg_catalog.encode(message, 'base64'),
    'additional', CASE WHEN additional IS NULL THEN NULL ELSE pg_catalog.encode(additional, 'base64') END,
    'context', CASE WHEN context IS NULL THEN NULL ELSE pg_catalog.encode(context, 'base64') END,
    'nonce', CASE WHEN nonce IS NULL THEN NULL ELSE pg_catalog.encode(nonce, 'base64') END
  )::text, 'utf8');
  RETURN extensions.pgp_sym_encrypt_bytea(
    envelope, vault._local_key(),
    'cipher-algo=aes256,compress-algo=0,s2k-mode=3,s2k-count=65011712'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION vault._crypto_aead_det_decrypt(
  message bytea, additional bytea, key_id bigint,
  context bytea DEFAULT 'pgsodium', nonce bytea DEFAULT NULL
)
RETURNS bytea
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  envelope jsonb;
BEGIN
  IF message IS NULL THEN RETURN NULL; END IF;
  IF key_id IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'local_vault_key_id_unsupported' USING ERRCODE = '22023';
  END IF;
  envelope := pg_catalog.convert_from(extensions.pgp_sym_decrypt_bytea(message, vault._local_key()), 'utf8')::jsonb;
  IF envelope->>'schema' IS DISTINCT FROM 'compute.local-vault.pgcrypto.v1'
    OR envelope->>'additional' IS DISTINCT FROM (CASE WHEN additional IS NULL THEN NULL ELSE pg_catalog.encode(additional, 'base64') END)
    OR envelope->>'context' IS DISTINCT FROM (CASE WHEN context IS NULL THEN NULL ELSE pg_catalog.encode(context, 'base64') END)
    OR envelope->>'nonce' IS DISTINCT FROM (CASE WHEN nonce IS NULL THEN NULL ELSE pg_catalog.encode(nonce, 'base64') END)
    OR envelope->>'message' IS NULL THEN
    RAISE EXCEPTION 'local_vault_ciphertext_invalid' USING ERRCODE = '22000';
  END IF;
  RETURN pg_catalog.decode(envelope->>'message', 'base64');
EXCEPTION
  WHEN SQLSTATE '55000' THEN RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'local_vault_ciphertext_invalid' USING ERRCODE = '22000';
END;
$function$;

CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  name text,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  key_id uuid,
  nonce bytea DEFAULT vault._crypto_aead_det_noncegen(),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS secrets_name_idx ON vault.secrets (name) WHERE name IS NOT NULL;
COMMENT ON TABLE vault.secrets IS 'Local pgcrypto-encrypted secrets; ciphertext is not Supabase AEAD compatible.';

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
SELECT s.id, s.name, s.description, s.secret,
  pg_catalog.convert_from(vault._crypto_aead_det_decrypt(
    message := pg_catalog.decode(s.secret, 'base64'),
    additional := pg_catalog.convert_to(s.id::text, 'utf8'),
    key_id := 0,
    context := 'pgsodium'::bytea,
    nonce := s.nonce
  ), 'utf8') AS decrypted_secret,
  s.key_id, s.nonce, s.created_at, s.updated_at
FROM vault.secrets s;

CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret text, new_name text DEFAULT NULL,
  new_description text DEFAULT '', new_key_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  secret_id uuid := pg_catalog.gen_random_uuid();
  secret_nonce bytea := vault._crypto_aead_det_noncegen();
BEGIN
  INSERT INTO vault.secrets(id, name, description, secret, nonce)
  VALUES (secret_id, new_name, new_description, pg_catalog.encode(vault._crypto_aead_det_encrypt(
    pg_catalog.convert_to(new_secret, 'utf8'), pg_catalog.convert_to(secret_id::text, 'utf8'),
    0, 'pgsodium'::bytea, secret_nonce
  ), 'base64'), secret_nonce);
  RETURN secret_id;
END;
$function$;

CREATE OR REPLACE FUNCTION vault.update_secret(
  secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL,
  new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE vault.secrets s
  SET secret = CASE WHEN new_secret IS NULL THEN s.secret ELSE pg_catalog.encode(vault._crypto_aead_det_encrypt(
      pg_catalog.convert_to(new_secret, 'utf8'), pg_catalog.convert_to(s.id::text, 'utf8'),
      0, 'pgsodium'::bytea, s.nonce
    ), 'base64') END,
    name = coalesce(new_name, s.name),
    description = coalesce(new_description, s.description),
    updated_at = pg_catalog.now()
  WHERE s.id = secret_id;
END;
$function$;

REVOKE ALL ON SCHEMA vault FROM PUBLIC;
REVOKE ALL ON TABLE vault.secrets, vault.decrypted_secrets FROM PUBLIC;
REVOKE ALL ON FUNCTION vault._local_key(), vault._crypto_aead_det_noncegen(),
  vault._crypto_aead_det_encrypt(bytea,bytea,bigint,bytea,bytea),
  vault._crypto_aead_det_decrypt(bytea,bytea,bigint,bytea,bytea),
  vault.create_secret(text,text,text,uuid), vault.update_secret(uuid,text,text,text,uuid)
FROM PUBLIC;

DO $privileges$
DECLARE
  denied_role text;
BEGIN
  FOR denied_role IN SELECT rolname FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA vault FROM %I', denied_role);
    EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM %I', denied_role);
    EXECUTE pg_catalog.format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vault FROM %I', denied_role);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA vault TO service_role;
    GRANT SELECT ON vault.decrypted_secrets TO service_role;
    GRANT EXECUTE ON FUNCTION vault._crypto_aead_det_decrypt(bytea,bytea,bigint,bytea,bytea),
      vault.create_secret(text,text,text,uuid), vault.update_secret(uuid,text,text,text,uuid) TO service_role;
  END IF;
END;
$privileges$;
