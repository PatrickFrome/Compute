# METAENGINE Browser — DP2 Typed Sandbox Plan Protocol

Date: 2026-08-29
Baseline: `4bb2d7c5373b1636fa4d99d9134ebad59775d2b5`, GitHub Actions run `33248344329` = SUCCESS.
Milestone: `DP2_VERIFICATION_SANDBOX_V1`

## Proven premise

The fail-closed sandbox planning core passed the full existing shell matrix at the baseline: contract tests, security gate, B-line contracts, Linux physical Development Plane smoke, and both Windows DP jobs.

This slice exposes planning through the real Development Plane without adding execution.

## Typed capabilities

- `VERIFICATION_SANDBOX_PLAN_CREATE`
- `VERIFICATION_SANDBOX_PLAN_VERIFY`

For both operations the utility worker independently reads the current repository HEAD and calls the DP1 candidate verifier itself. A caller-provided verification receipt is never accepted as an authority token.

The worker then calls the pure DP2 planning core. The caller may request a backend name and bounded resource envelope, but cannot provide a command, argv, filesystem path to execute, credentials, network allowlist, backend identity, or execution flag.

## Capability state

Development Plane protocol version becomes `0.3.0` and reports:
- `verification_sandbox_planning=true`
- `verification_sandbox_prepare_only=true`
- `verification_sandbox_execution=false`
- `sandbox_backend_bound=false`
- `direct_promote_current=false`
- `arbitrary_eval=false`

No capability spawns a subprocess or reaches a remote sandbox backend.

## Physical proof contract

The isolated Electron smoke now performs:
1. exact repo HEAD read;
2. DP1 candidate create + verify;
3. DP2 sandbox plan create with `CLOUDFLARE_SANDBOX` only as an unbound requested backend;
4. DP2 plan verify;
5. assertions that source is read-only, host repository is not mounted, network is deny-by-default, credentials are not brokered, backend is unbound, execution is unauthorized, and promotion is unauthorized;
6. cooperative DP shutdown.

Trace schema advances to `metaengine.development-plane.stage-trace.v4` and emits `DP_SANDBOX_PLAN_VERIFIED` before shutdown.

## Non-claims

- No Cloudflare, Vercel, Firecracker, gVisor, Kata or other sandbox was launched.
- No command was executed on behalf of a candidate.
- No sandbox backend identity has been verified.
- No candidate was built, signed, promoted, or activated.
- DP2 remains ACTIVE/PREPARE_ONLY until a physical backend lifecycle is independently proven.

## Next gate

A later DP2 slice may bind one backend only after source-of-truth contains an explicit backend identity/safety receipt. Backend execution must remain typed, ephemeral, resource-bounded, network-deny-default, output-manifest-bound, and teardown-proven.
