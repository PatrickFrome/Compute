# AOP1 W1 Preflight Dispatch Bridge — Research Before

Date: 2026-08-22
Semantic head reviewed: `metaengine-h205f22-recovery-dev-20260821-cp072`
Target: `W1_PERSISTENT_LINUX_WORKER_SAFETY -> canonical C1 First Real Linux Worker`

## Live starting state

- W1 is `IN_PROGRESS` under the AOP-owned authority path (`aop1:W1_IMPLEMENTER`).
- Current production W1 evidence remains zero for backend binding, provider reboot receipt, Linux safety observation, and Linux safety verification.
- GitHub `main` is `a6d33bfc5b85a3efce16c15620240e1ff0b1acb8`, containing W1 STEP08 PREPARE_ONLY protected-host identity preflight.
- The existing AOP1 Worker can read/write role-owned GitHub branches when a runtime GitHub credential exists, but has no workflow-dispatch primitive.
- The deployed AOP1 health contract currently reports `github_configured=false` / `github_auth_mode=none`; therefore this change does not claim a live dispatch occurred.

## Current external research

### GitHub Actions dispatch

GitHub REST API version `2026-03-10` supports `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` with a workflow file name, a required `ref`, and declared workflow inputs. Fine-grained GitHub App installation tokens require repository permission `Actions: write` for this endpoint. Current documentation returns a workflow run id and URLs on successful dispatch.

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
5. Add a read-only tool for recent W1 preflight runs.
6. Refuse a new dispatch while an earlier W1 preflight run is active.
7. Preserve explicit nonclaims in the dispatch receipt: no real reboot, no persistent-worker proof, no W1 verification.
8. Do not expose main writes, arbitrary workflow dispatch, checkpoint sealing, or real-reboot workflow dispatch.

## Verification required before promotion

- Review exact diff against `work/aop1-autonomous-orchestration`.
- Run `wrangler types` and TypeScript `tsc --noEmit` through repository CI or an equivalent exact-head check.
- Verify GitHub App permission semantics against current GitHub docs after implementation.
- Verify production Supabase W1 evidence counts remain unchanged.
- Do not deploy the bridge as evidence of C1; deployment only makes the external preflight gate addressable once runtime GitHub App credentials are configured.

## Strict nonclaims

`NO_W1_WORKFLOW_DISPATCH`, `NO_AWS_API_CALL`, `NO_EC2_REBOOT`, `NO_BACKEND_BINDING`, `NO_PERSISTENT_WORKER_PROOF`, `W1_VERIFIED=false`, `NO_C1_PROMOTION`, `NO_CP073_SEAL`.
