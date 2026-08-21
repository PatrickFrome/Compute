-- METAENGINE H205F22 / T0_HERMETIC_TOOLCHAIN_CONTRACT / v3 delta
-- Requires sql/t0_hermetic_toolchain_contract_v2.sql.
-- Candidate evidence only: canonical=false, authority_effect=false.
-- This file does NOT grant worker admission, prove W1 parity, enable shared cache reuse,
-- merge main, reserve a checkpoint, or seal a checkpoint.

with prev as (
  select contract
  from destruktion_meta.compute_fabric_toolchain_contract_h205f22
  where contract_key='hermetic-v2'
), next_contract as (
  select jsonb_set(
    jsonb_set(
      contract,
      '{schema}',
      to_jsonb('metaengine.compute.hermetic-toolchain-contract.h205f22.v3'::text),
      false
    ),
    '{toolset_identity,allowed_names_by_role}',
    jsonb_build_object(
      'compiler.c',jsonb_build_array('clang','gcc'),
      'compiler.cxx',jsonb_build_array('clang++','g++'),
      'compiler.rust',jsonb_build_array('rustc'),
      'compiler.go',jsonb_build_array('go'),
      'runtime.python',jsonb_build_array('python','python3'),
      'runtime.node',jsonb_build_array('node'),
      'runtime.jvm',jsonb_build_array('java'),
      'linker',jsonb_build_array('lld','ld','ld.lld','gold'),
      'archiver',jsonb_build_array('llvm-ar','ar'),
      'build.bazel',jsonb_build_array('bazel','bazelisk'),
      'build.cmake',jsonb_build_array('cmake'),
      'build.ninja',jsonb_build_array('ninja'),
      'build.make',jsonb_build_array('make'),
      'package.cargo',jsonb_build_array('cargo'),
      'package.npm',jsonb_build_array('npm'),
      'package.pnpm',jsonb_build_array('pnpm'),
      'package.yarn',jsonb_build_array('yarn'),
      'package.pip',jsonb_build_array('pip','pip3'),
      'package.uv',jsonb_build_array('uv'),
      'package.go',jsonb_build_array('go')
    ),
    true
  ) as body
  from prev
)
insert into destruktion_meta.compute_fabric_toolchain_contract_h205f22(
  contract_key,schema_version,hash_algorithm,environment_mode,required_environment_keys,
  contract,contract_sha256,enabled,canonical,authority_effect
)
select
  'hermetic-v3',3,'SHA256','DECLARED_COMPLETE',
  array['PATH','LC_ALL','TZ','SOURCE_DATE_EPOCH'],
  body,
  encode(extensions.digest(
    convert_to(destruktion_meta.compute_fabric_canonical_json_h205f22(body),'UTF8'),
    'sha256'
  ),'hex'),
  true,false,false
from next_contract
on conflict (contract_key) do nothing;

create or replace function destruktion_meta.compute_fabric_derive_toolchain_identity_v3_h205f22(
  p_descriptor jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta, extensions
as $$
declare
  v_c destruktion_meta.compute_fabric_toolchain_contract_h205f22%rowtype;
  v_v2_input jsonb;
  v_v2 jsonb;
  v_entry jsonb;
  v_allowed_names jsonb;
  v_body jsonb;
  v_sha text;
begin
  select * into v_c
  from destruktion_meta.compute_fabric_toolchain_contract_h205f22
  where contract_key='hermetic-v3' and enabled;
  if not found then raise exception 'active hermetic-v3 contract not found'; end if;

  if p_descriptor is null or jsonb_typeof(p_descriptor)<>'object' then
    raise exception 'toolchain descriptor must be object';
  end if;
  if p_descriptor->>'schema' is distinct from 'metaengine.compute.toolchain-identity-input.h205f22.v3' then
    raise exception 'toolchain descriptor schema mismatch';
  end if;

  if jsonb_typeof(p_descriptor->'tools')<>'array' then
    raise exception 'tools array required';
  end if;
  for v_entry in select value from jsonb_array_elements(p_descriptor->'tools') loop
    v_allowed_names := (v_c.contract#>'{toolset_identity,allowed_names_by_role}')->(v_entry->>'role');
    if jsonb_typeof(v_allowed_names) <> 'array'
       or not exists (
         select 1
         from jsonb_array_elements_text(v_allowed_names) n(value)
         where n.value = v_entry->>'name'
       ) then
      raise exception 'unknown tool name for role %: %',
        coalesce(v_entry->>'role','<null>'), coalesce(v_entry->>'name','<null>');
    end if;
  end loop;

  -- Reuse v2 for exact-field, runtime, version/digest, lockfile, dependency,
  -- platform, environment, and execution-parameter validation/normalization.
  v_v2_input := jsonb_set(
    p_descriptor,
    '{schema}',
    to_jsonb('metaengine.compute.toolchain-identity-input.h205f22.v2'::text),
    false
  );
  v_v2 := destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_v2_input);

  v_body := jsonb_build_object(
    'schema','metaengine.compute.toolchain-identity.h205f22.v3',
    'contract_key',v_c.contract_key,
    'contract_sha256',v_c.contract_sha256,
    'runtime',v_v2->'runtime',
    'tools',v_v2->'tools',
    'lockfiles',v_v2->'lockfiles',
    'dependencies',v_v2->'dependencies',
    'platform',v_v2->'platform',
    'environment',v_v2->'environment',
    'execution_parameters',v_v2->'execution_parameters'
  );

  v_sha := encode(extensions.digest(
    convert_to(destruktion_meta.compute_fabric_canonical_json_h205f22(v_body),'UTF8'),
    'sha256'
  ),'hex');

  return v_body || jsonb_build_object(
    'toolchain_digest',v_sha,
    'toolchain_identity_sha256',v_sha,
    'canonicalization','METAENGINE_CANONICAL_JSON_V1',
    'cache_safe_identity',true,
    'canonical',false,
    'authority_effect',false
  );
end;
$$;

create or replace function destruktion_meta.compute_fabric_assert_toolchain_identity_v3_h205f22(
  p_descriptor jsonb,
  p_expected_sha256 text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare v_identity jsonb;
begin
  if coalesce(p_expected_sha256,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'expected toolchain digest must be 64 lowercase hex';
  end if;
  v_identity := destruktion_meta.compute_fabric_derive_toolchain_identity_v3_h205f22(p_descriptor);
  if v_identity->>'toolchain_digest' is distinct from p_expected_sha256 then
    raise exception 'toolchain digest mismatch';
  end if;
  return v_identity;
end;
$$;

create or replace function destruktion_meta.compute_fabric_toolchain_v3_selftest_h205f22()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_base jsonb;
  v_arm jsonb;
  v_bad jsonb;
  v_base_digest text;
  v_arm_digest text;
  v_unknown_name_rejected boolean := false;
  v_unknown_role_rejected boolean := false;
  v_unknown_env_rejected boolean := false;
  v_mismatch_rejected boolean := false;
  v_v2 jsonb;
  v_expected constant text := '28a1bc1546b4da92832e8911083324d144e5b0fecf96f85fe475d10c275b0228';
  v_arm_expected constant text := '17c7016e83d534e8c34754e8707bf0a7514da7838f2fb550f3ff25d986113411';
begin
  v_v2 := destruktion_meta.compute_fabric_toolchain_v2_selftest_h205f22();
  if v_v2->>'status' <> 'PASS' then raise exception 'v2 invariant regression'; end if;

  v_base := jsonb_build_object(
    'schema','metaengine.compute.toolchain-identity-input.h205f22.v3',
    'runtime',jsonb_build_object('kind','OCI_IMAGE','digest','sha256:'||repeat('1',64),'version','ubuntu-24.04'),
    'tools',jsonb_build_array(
      jsonb_build_object('role','compiler.c','name','clang','version','18.1.8','sha256',repeat('2',64)),
      jsonb_build_object('role','build.ninja','name','ninja','version','1.12.1','sha256',repeat('3',64))
    ),
    'lockfiles',jsonb_build_array(
      jsonb_build_object('path','Cargo.lock','sha256',repeat('4',64)),
      jsonb_build_object('path','pnpm-lock.yaml','sha256',repeat('5',64))
    ),
    'dependencies',jsonb_build_array(
      jsonb_build_object('uri','pkg:cargo/serde@1.0.219','digest','sha256:'||repeat('6',64)),
      jsonb_build_object('uri','pkg:npm/typescript@5.9.2','digest','sha256:'||repeat('7',64))
    ),
    'platform',jsonb_build_object('os','linux','arch','amd64','libc','glibc-2.39'),
    'environment',jsonb_build_object('PATH','/toolchain/bin','LC_ALL','C.UTF-8','TZ','UTC','SOURCE_DATE_EPOCH','0'),
    'execution_parameters',jsonb_build_object('target','x86_64-unknown-linux-gnu','optimization','release','lto','thin')
  );

  v_base_digest := destruktion_meta.compute_fabric_derive_toolchain_identity_v3_h205f22(v_base)->>'toolchain_digest';
  if v_base_digest <> v_expected then raise exception 'v3 fixture digest drift'; end if;

  v_arm := jsonb_set(v_base,'{platform,arch}','"arm64"'::jsonb,false);
  v_arm_digest := destruktion_meta.compute_fabric_derive_toolchain_identity_v3_h205f22(v_arm)->>'toolchain_digest';
  if v_arm_digest <> v_arm_expected or v_arm_digest = v_base_digest then
    raise exception 'cross-platform identity separation failed';
  end if;

  begin
    v_bad := jsonb_set(v_base,'{tools,0,name}','"evilcc"'::jsonb,false);
    perform destruktion_meta.compute_fabric_derive_toolchain_identity_v3_h205f22(v_bad);
  exception when others then v_unknown_name_rejected := true; end;

  begin
    v_bad := jsonb_set(v_base,'{tools,0,role}','"compiler.zig"'::jsonb,false);
    perform destruktion_meta.compute_fabric_derive_toolchain_identity_v3_h205f22(v_bad);
  exception when others then v_unknown_role_rejected := true; end;

  begin
    v_bad := jsonb_set(v_base,'{environment,HOME}','"/tmp"'::jsonb,true);
    perform destruktion_meta.compute_fabric_derive_toolchain_identity_v3_h205f22(v_bad);
  exception when others then v_unknown_env_rejected := true; end;

  begin
    perform destruktion_meta.compute_fabric_assert_toolchain_identity_v3_h205f22(v_arm, v_expected);
  exception when others then v_mismatch_rejected := true; end;

  if not (v_unknown_name_rejected and v_unknown_role_rejected and v_unknown_env_rejected and v_mismatch_rejected) then
    raise exception 'v3 negative canary failure';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute.toolchain-selftest.h205f22.v3',
    'status','PASS',
    'fixture_digest',v_expected,
    'arm64_digest',v_arm_expected,
    'cross_platform_separation',true,
    'unknown_tool_name_rejected',v_unknown_name_rejected,
    'unknown_tool_role_rejected',v_unknown_role_rejected,
    'unknown_env_rejected',v_unknown_env_rejected,
    'cross_platform_mismatch_rejected',v_mismatch_rejected,
    'v2_regression_suite',v_v2,
    'authority_effect',false
  );
end;
$$;

create or replace function destruktion_meta.compute_fabric_toolchain_v3_evidence_h205f22()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_contract destruktion_meta.compute_fabric_toolchain_contract_h205f22%rowtype;
  v_selftest jsonb;
begin
  select * into v_contract
  from destruktion_meta.compute_fabric_toolchain_contract_h205f22
  where contract_key='hermetic-v3';
  if not found then raise exception 'hermetic-v3 contract missing'; end if;
  if v_contract.contract_sha256 <> '05f3f28e1e57250c77d37338150ee1e3f4efcb0d0772444e9865ee9e9f4a203e' then
    raise exception 'hermetic-v3 contract hash drift';
  end if;
  if v_contract.canonical or v_contract.authority_effect then
    raise exception 'T0 contract must remain noncanonical and authority-free';
  end if;
  v_selftest := destruktion_meta.compute_fabric_toolchain_v3_selftest_h205f22();
  if v_selftest->>'status' <> 'PASS' then raise exception 'T0 v3 selftest failed'; end if;
  return jsonb_build_object(
    'schema','metaengine.compute.toolchain-evidence.h205f22.v3',
    'status','PASS',
    'contract_key',v_contract.contract_key,
    'contract_sha256',v_contract.contract_sha256,
    'selftest',v_selftest,
    'canonical',false,
    'authority_effect',false,
    'shared_cache_reuse',false,
    'parity_claimed',false,
    'requires_real_w1_for_t1',true
  );
end;
$$;

revoke all on function destruktion_meta.compute_fabric_derive_toolchain_identity_v3_h205f22(jsonb)
from public, anon, authenticated;
revoke all on function destruktion_meta.compute_fabric_assert_toolchain_identity_v3_h205f22(jsonb,text)
from public, anon, authenticated;
revoke all on function destruktion_meta.compute_fabric_toolchain_v3_selftest_h205f22()
from public, anon, authenticated;
revoke all on function destruktion_meta.compute_fabric_toolchain_v3_evidence_h205f22()
from public, anon, authenticated;

grant execute on function destruktion_meta.compute_fabric_derive_toolchain_identity_v3_h205f22(jsonb)
to service_role;
grant execute on function destruktion_meta.compute_fabric_assert_toolchain_identity_v3_h205f22(jsonb,text)
to service_role;
grant execute on function destruktion_meta.compute_fabric_toolchain_v3_selftest_h205f22()
to service_role;
grant execute on function destruktion_meta.compute_fabric_toolchain_v3_evidence_h205f22()
to service_role;

-- Acceptance evidence: must remain PASS and authority/cache/parity false.
select destruktion_meta.compute_fabric_toolchain_v3_evidence_h205f22();
