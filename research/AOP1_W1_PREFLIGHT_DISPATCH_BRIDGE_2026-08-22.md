# AOP1 W1 Preflight Dispatch Bridge — Research Before / After

Date: 2026-08-22
Semantic head reviewed: `metaengine-h205f22-recovery-dev-20260821-cp072`
Target: `W1_PERSISTENT_LINUX_WORKER_SAFETY -> canonical C1 First Real Linux Worker`

## Research Before

### Live starting state

- W1 is `IN_PROGRESS` under the AOP-owned authority path (`aop1:W1_IMPLEMENTER`).
- Current production W1 evidence remains zero for backend binding, provider reboot receipt, Linux safety observation, and Linux safety verification.
- GitHub `main` is `a6d33bfc5b85a3efce16c15620240e1ff0b1acb8`, containing W1 STEP08 PREPARE_ONLY protected-host identity preflight.
- The existing AOP1 Worker can read/write role-owned GitHub branches when a runtime GitHub credential exists, but has no workflow-dispatch primitive.
- The deployed AOP1 health contract currently reports `github_configured=false` / `github_auth_mode=none`; therefore this change does not claim a live dispatch occurred.

### GitHub Actions dispatch

GitHub REST API version `2026-03-10` supports `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` with a workflow file name, a required `ref`, and declared workflow inputs. Fine-grained GitHub App installation tokens require repository permission `Actions: write` for this endpoint.

### GitHub environments

Environment protection rules must pass before a job using the environment proceeds. Branch/deployment policy therefore remains an independent gate; dispatch success alone is not evidence that protected environment, AWS OIDC, host identity, or EC2 DryRun succeeded.

### AWS

`EC2 RebootInstances` with `DryRun=true` checks authorization and does not perform the reboot. The STEP08 workflow contains only this dry-run operation, so exposing STEP08 dispatch does not grant a real reboot capability.

### Cloudflare

Cloudflare Workers guidance requires secrets to stay in Worker secrets / Secrets Store rather than source or `vars`. Existing AOP1 GitHub App fields remain runtime secrets. This bridge does not add credentials to source control.

## Adopted design

1. Keep the GitHub App installation-token model; request `actions:write` only on its short-lived repository token.
2. Add a fixed workflow primitive for `w1-aws-persistent-host-preflight.yml` only.
3. Hard-code `ref=main` and `confirmation=PREFLIGHT_W1_PERSISTENT_HOST_ONLY`; do not expose workflow/ref/input parameters to the model.
4. Expose dispatch only when the leased role is exactly `W1_IMPLEMENTER` for `W1_PERSISTENT_LINUX_WORKER_SAFETY`.
5. Require GitHub App authentication at both executor and `dispatchW1Preflight()` helper boundaries; a generic fallback token cannot dispatch W1 preflight.
6. Add a read-only tool for recent W1 preflight runs.
7. Refuse a new dispatch while an earlier W1 preflight run is active.
8. Preserve explicit nonclaims in the dispatch receipt: no real reboot, no persistent-worker proof, no W1 verification.
9. Do not expose main writes, arbitrary workflow dispatch, checkpoint sealing, or real-reboot workflow dispatch.

## Research After

### Permission boundary verified against current GitHub documentation

- `Create a workflow dispatch event` requires repository `Actions: write` for a GitHub App installation access token.
- GitHub App installation access tokens can be narrowed to selected repositories and a subset of the permissions granted to the App; the bridge requests only the `Compute` repository.
- Adding a new repository permission to a GitHub App does **not** silently expand an existing installation. The installation owner must approve the changed permission set; until approval, the installation retains its old permissions.
- This finding changed the implementation: W1 dispatch is GitHub-App-only in both the model-facing executor and the helper itself. A PAT or generic `GITHUB_TOKEN` remains insufficient for the privileged W1 bridge.

### Secret boundary reconfirmed against current Cloudflare documentation

GitHub App identifiers/private key required by the Worker must be supplied through Worker secrets / Secrets Store. They must not be committed to source or placed in plaintext Wrangler `vars`. The code change adds no credential values.

### Exact-head verification

The final code hardening head before this research-after commit is:

`579d1b1b7e2b4ee4c59ed3d650cad7f72073452c`

Exact-head CI:

- `AOP1 contract` run `32596390521` / run number `120`: **SUCCESS**.
- `AOP1 Cloudflare Check` run `32596390530` / run number `6`: **SUCCESS**.
- The Cloudflare check executes the repository AOP1 `npm run check` path (`wrangler types` + TypeScript `tsc --noEmit`) without deploying the Worker.

Earlier App-only executor hardening head `a060e4a7e530b2ca7d2058d4fa72aabe810be4f0` also passed `AOP1 contract` run `32596298740` and `AOP1 Cloudflare Check` run `32596298731`.

### Production truth after implementation

Live Supabase re-audit after the final code hardening:

- semantic head: `metaengine-h205f22-recovery-dev-20260821-cp072` unchanged;
- W1: `IN_PROGRESS`;
- active authority: claim `#18`, holder `aop1:W1_IMPLEMENTER`;
- backend bindings: `0`;
- reboot receipts: `0`;
- Linux safety observations: `0`;
- Linux safety verifications: `0`.

Supabase security/performance advisors were re-run. No DDL was performed by this step. The advisor surface remains the existing INFO-only classes (RLS enabled without policies on internal `destruktion_meta` tables and unused-index candidates); no advisor result is treated as permission to open RLS access or drop indexes during W1 recovery.

## Result of this semantic step

The missing orchestration-to-external-execution bridge is implemented and tested, but it is still **CONTROL_PLANE_ONLY / PREPARE_ONLY** until the runtime GitHub App installation is granted and approves `Actions: write`, its credentials are stored as Cloudflare Worker secrets, and the updated Worker is deployed and reports `github_auth_mode=app`.

The next physical gate is therefore:

1. merge this reviewed bridge into `work/aop1-autonomous-orchestration`;
2. deploy the AOP Worker through the existing deployment path;
3. configure/approve the repository-scoped GitHub App `Actions: write` permission and Worker App secrets;
4. verify live health reports GitHub App auth;
5. wake W1 AOP and inspect existing W1 preflight runs;
6. dispatch the exact STEP08 PREPARE_ONLY workflow only;
7. review its environment/AWS DryRun artifacts before any real reboot is even considered.

## Strict nonclaims

`NO_W1_WORKFLOW_DISPATCH`, `NO_AWS_API_CALL`, `NO_EC2_REBOOT`, `NO_BACKEND_BINDING`, `NO_PERSISTENT_WORKER_PROOF`, `W1_VERIFIED=false`, `NO_C1_PROMOTION`, `NO_CP073_SEAL`.
