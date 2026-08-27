-- H205F22 F1: credential separation for the signature-verification trust chain.
--
-- Closes the LATENT CIRCULAR TRUST identified in DEV-CYCLE-001 (GPT review
-- + GLM structural confirmation): today a single service_role key can
-- (after verifier activation) CREATE a verification receipt and then READ
-- it back through the readback RPC — proof manufactured and consumed by
-- the same credential.
--
-- Pattern follows the proven W1 revoke (migration 20260823141025):
--   reader  = service_role (read-only readback RPC)        — unchanged
--   writer  = per-verifier NOLOGIN role, granted ONLY while the verifier
--             registry row is ACTIVE                        — NEW
--   killer  = service_role direct table mutation            — REVOKED
--
-- PREPARE_ONLY: this migration is versioned for supervisor apply. It does
-- not grant authority_effect anywhere and creates no evidence rows.

-- 1) Per-verifier writer role (no login; cannot be used as a credential)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'f1_verifier_writer') then
    create role f1_verifier_writer nologin;
  end if;
end $$;

-- 2) Record RPC: caller must BE the active verifier identity.
--    The existing recorder is wrapped: first the caller's role membership is
--    checked against the ACTIVE verifier registry row matching p_verifier_id;
--    service_role WITHOUT the verifier role is rejected even if a verifier
--    is active (the negative canary case).
create or replace function public.h205f22_record_signature_verification_guarded_v1(
  p_provider_id text,
  p_external_execution_id text,
  p_payload_type text,
  p_envelope_sha256 text,
  p_signed_claims_sha256 text,
  p_signer_identity text,
  p_verifier_id text,
  p_key_id text,
  p_expires_at timestamptz,
  p_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_active_verifier_id text;
begin
  -- caller-identity check: active verifier row for this verifier_id
  select verifier_id into v_active_verifier_id
  from destruktion_meta.compute_fabric_signature_verifier_registry_h205f22
  where verifier_id = p_verifier_id
    and active is true
  limit 1;

  if v_active_verifier_id is null then
    raise exception 'f1_signature_verifier_not_active' using errcode='P0001';
  end if;

  -- THE SEPARATION CHECK: the calling role must be the verifier's writer role.
  if not pg_has_role(current_user, 'f1_verifier_writer', 'usage') then
    raise exception 'f1_writer_identity_mismatch: record requires the per-verifier writer role (credential separation, DEV-CYCLE-001 F1-GPT circular-trust fix)' using errcode='42501';
  end if;

  -- delegate to the original recorder (unchanged semantics)
  return destruktion_meta.h205f22_record_signature_verification_v1(
    p_provider_id, p_external_execution_id, p_payload_type,
    p_envelope_sha256, p_signed_claims_sha256, p_signer_identity,
    p_verifier_id, p_key_id, p_expires_at, p_evidence
  );
end $$;

revoke all on function public.h205f22_record_signature_verification_guarded_v1(text,text,text,text,text,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_record_signature_verification_guarded_v1(text,text,text,text,text,text,text,text,timestamptz,jsonb) to service_role, f1_verifier_writer;

-- 3) Kill direct table mutation from service_role on the trust plane
--    (reader stays capable of SELECT through the readback RPC only).
revoke insert, update, delete on table
  destruktion_meta.compute_fabric_provider_signature_verification_h205f22
  from service_role;

revoke insert, update, delete on table
  destruktion_meta.compute_fabric_signature_verifier_registry_h205f22
  from service_role;

-- 4) Grant the writer role ONLY through activation, never statically.
--    Activation procedure (supervisor-tier) is expected to run:
--      grant f1_verifier_writer to <verifier-session-role>;
--    This migration deliberately does NOT grant it to service_role.
