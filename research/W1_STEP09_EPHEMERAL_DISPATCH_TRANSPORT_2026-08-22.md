# W1 STEP09 — Ephemeral Dispatch Transport Research Before

Date: 2026-08-22
Target: `W1_PERSISTENT_LINUX_WORKER_SAFETY -> C1 First Real Linux Worker`
Semantic head: `metaengine-h205f22-recovery-dev-20260821-cp072`
Exact main: `a6d33bfc5b85a3efce16c15620240e1ff0b1acb8`
Active W1 authority at execution gate: claim `#18`, holder `aop1:W1_IMPLEMENTER`.

## Why this transport exists

The persistent AOP1 W1 dispatch bridge is now deployed, but its live health correctly reports `github_configured=false` / `github_auth_mode=none` because GitHub App runtime credentials and the new `Actions: write` installation permission are not yet configured. Waiting for that administrative gate would not improve W1 safety evidence.

This one-shot transport uses only the repository-native, job-scoped `GITHUB_TOKEN` to invoke the already-reviewed STEP08 workflow. It does not alter STEP08, does not add AWS credentials, and does not expose any real-reboot capability.

## Research-before findings

1. GitHub creates a repository-scoped `GITHUB_TOKEN` for each Actions job and expires it after the job.
2. Workflow permissions can be narrowed explicitly; the dispatcher needs only `actions: write` to create the workflow-dispatch event and `contents: write` to persist a sanitized one-shot receipt on its isolated branch.
3. Events created with `GITHUB_TOKEN` normally do not recursively start workflows, but `workflow_dispatch` and `repository_dispatch` are documented exceptions. Therefore the target STEP08 can be dispatched without a long-lived PAT/App key.
4. The GitHub workflow-dispatch API accepts a workflow filename, required ref, and declared inputs. This transport hard-codes all three and exposes none as user/model inputs.
5. STEP08 on `main` remains PREPARE_ONLY: it contains only `EC2 RebootInstances --dry-run`, not a real reboot request. Environment policy, GitHub deployment compatibility, protected host identity, AWS OIDC and DryRun authorization remain independent fail-closed gates inside STEP08.

## One-shot safety design

- Branch is pinned from exact `main` at `a6d33bfc5b85a3efce16c15620240e1ff0b1acb8`.
- Dispatcher triggers only on a push that adds its own workflow file on `ops/w1-step08-one-shot-20260822`.
- Job guard requires `github.actor_id == '20597814'` and the exact branch ref.
- Target workflow is fixed to `.github/workflows/w1-aws-persistent-host-preflight.yml`.
- Target ref is fixed to `main`.
- Confirmation is fixed to `PREFLIGHT_W1_PERSISTENT_HOST_ONLY`.
- Before dispatch, the job checks that `evidence/w1-step08-one-shot-dispatch.json` does not exist. Existing receipt means fail closed.
- After a successful dispatch, it persists only a sanitized receipt containing run id/URL, source SHA, target workflow/ref and explicit nonclaims.
- The receipt commit made with the same `GITHUB_TOKEN` is not used as a trigger; the dispatcher path filter matches only the workflow file itself.
- After receipt inspection, the dispatcher workflow file will be deleted from this branch.

## Production truth before execution

- W1: `IN_PROGRESS`.
- backend bindings: `0`.
- reboot receipts: `0`.
- Linux safety observations: `0`.
- Linux safety verifications: `0`.
- No real reboot is authorized by this step.

## Strict nonclaims

`NO_STEP08_DISPATCH_YET`, `NO_AWS_API_CALL`, `NO_EC2_REBOOT`, `NO_BACKEND_BINDING`, `NO_PERSISTENT_WORKER_PROOF`, `W1_VERIFIED=false`, `NO_C1_PROMOTION`, `NO_CP073_SEAL`.
