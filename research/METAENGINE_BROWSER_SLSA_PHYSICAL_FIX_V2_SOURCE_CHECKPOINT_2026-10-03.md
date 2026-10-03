# SLSA physical fix V2: source checkpoint (2026-10-03)

## Authority and scope

Repository: PatrickFrome/Compute. Preserve consumed physical head
`b8f2f438bf3d9450a301ebb525eb95181f6d464d` and package version
`0.7.0-dev.37076000001.1`; never rerun that physical identity.
Continue the existing fix branch `work/build-slsa-physical-fix-v2` from
`129b941dce43223c7514a8c6e227c22675911827`. No second installer producer,
release promotion, user-machine installation or database mutation is introduced.

## Verified failures and fixes

- Source run `37076882275` already passed the full Linux Browser Node suite,
  then failed the root topology assertion hard-coded to version 37006000001.
  The assertion now checks package, both lock versions and the reserved manifest
  identity for exact equality, and retains the version shape constraint.
- Physical Windows full-suite logs exposed a CRLF-sensitive upload-step parser
  in `installer-provenance.test.mjs`. Normalize line endings before matching;
  preserve upload conditions, artifact identity and all substantive assertions.
- Dirty Profile run `37076381677` reached terminal producer verification and
  failed `token_missing`. Give Wait the same job-scoped GitHub token as Acquire;
  assert both steps are wired. No token is persisted in a proof or installer.
- Installed Chat run `37076381669` received HTTP 403. Deployed qualification
  function V7 is pinned to `719febc00bd8879715a0633e8fe9d85acacead41` and admits
  only PR or the exact release push. Its policy rejects the dedicated physical
  branch deterministically. The available run log does not expose the response
  diagnostic, so live closure remains a required physical gate.
- Add the one exact physical branch to qualification trust. Pure production
  push policy binds signed repository IDs, GitHub-hosted runner, exact ref/sub,
  workflow ref/SHA, source SHA, run ID/attempt and GitHub run readback. Physical
  reruns are rejected. Existing JWT verification, PR admission and nonce-bound
  approval RPC remain in place. No wildcard branch admission is added.
- Existing V2 corrections to package identity, scoped SLSA permissions and the
  additional verifier checkout are retained.

## Source validation

37 focused policy/topology tests passed locally, including 24 rejection cases.
All locally available workflow YAML parsed. The sparse local checkout cannot
run the full provenance suite (build-identity helper not materialized).
Source qualification now runs the complete Browser Node suite and focused
contracts on Linux and Windows, with frozen dependency installation and a clean
checkout check. It does not reserve, build, attest or install a package.

## Research and rationale

- GitHub OIDC reference: https://docs.github.com/en/actions/reference/security/oidc
  Use verified claims plus exact run readback; accept legacy and immutable-ID
  subjects only for the intended repository and branches. On push, source and
  workflow SHA must be the same qualified commit.
- Supabase function authentication:
  https://supabase.com/docs/guides/functions/auth
  This existing custom GitHub-JWT endpoint retains verify_jwt=false at the
  platform layer, but still verifies signature, issuer, audience and claims.
  A platform JWT toggle is not evidence of unauthenticated enrollment.

## Next gates

1. Require terminal source qualification on Linux and Windows.
2. Deploy only the installed-qualification function, pinned to the qualified
   commit. Preserve V7's immutable import as rollback evidence; read back deploy.
3. Allocate a fresh monotonic package version and source SHA; push the physical
   branch once. Never rerun the consumed prior head or reuse its version.
4. Require all ten physical workflows and exact installer/SLSA bindings to pass.
   ADMIN_CONNECTED is distinct from real z.ai Agent task/result qualification.

SLSA evidence is supply-chain evidence, not release or user-machine authority.
