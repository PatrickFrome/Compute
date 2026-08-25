# W1 Provider-Neutral Causal Closure V2 — PREP / NON-AUTHORITY

Status: design evidence only. This document does **not** change production W1 semantics, admit a worker, verify W1, or authorize provider mutations.

## Production facts discovered

The current W1 v1 causal closure is effectively AWS-specific even though some surrounding schemas use generic backend names.

1. `h205f22_w1_admission_candidate_readback_v1` requires a persistent backend binding with backend kind `NATIVE_LINUX` or `SELF_HOSTED_VM`, a verified safety receipt, pre/post host probe receipts, and an accepted provider reboot receipt.
2. The reboot receipt is passed to `compute_fabric_validate_signed_reboot_identity_h205f22`.
3. That validator rejects every provider except `AWS_EC2` and binds to AWS EC2 IID + CloudTrail `RebootInstances` semantics, an EC2 `i-*` instance id, a 12-digit AWS account and the pinned `us-east-2` IID verifier contract.
4. Legacy backend binding permits only `NATIVE_LINUX`, `SELF_HOSTED_VM`, and `VERCEL_SANDBOX`; it does not represent `GITHUB_CODESPACES`.
5. For `VERCEL_SANDBOX`, the legacy backend trigger requires `persistence_mode=EPHEMERAL` and explicitly states that snapshots do not make the worker persistent.
6. Therefore Codespaces, Vercel Sandbox, and generic non-AWS self-hosted providers cannot honestly become a W1 v1 admission candidate merely by changing labels or backend metadata.

Legacy v1 must remain unchanged as the AWS evidence path.

## Existing additive v2 layer

`20260825023000_w1_provider_neutral_lifecycle_receipt_v2.sql` intentionally stores raw lifecycle receipts only. It is fail-closed:

- `verification_status=PENDING_PROVIDER_VALIDATION`
- `provider_identity_verified=false`
- `lifecycle_action_verified=false`
- `accepted=false`
- `persistent_worker_proof=false`
- `worker_admitted=false`
- `w1_verified=false`

This is necessary but not sufficient for causal closure.

## Required additive v2 architecture

### V2-A — provider-neutral backend binding

Create a new additive table rather than weakening legacy backend constraints. It must bind exactly one enrollment/worker to:

- provider kind and stable provider object id;
- provider account/project/repository identity as applicable;
- lifecycle model (`STOP_RESUME`, `REBOOT`, or provider-native equivalent);
- persistence model with explicit semantic definition;
- execution session id / observation time;
- endpoint/capability reference containing no raw secrets;
- immutable evidence hashes;
- `canonical=false`, `authority_effect=false`.

No provider kind should inherit persistence semantics merely because it supports snapshots.

### V2-B — authenticated provider verification receipt

Raw lifecycle JSON must never self-promote. A separate receipt must be generated only by a provider-specific trusted verifier and bind:

- raw lifecycle receipt id + SHA-256;
- provider object identity;
- authenticated API/control-plane identity;
- pre/post provider snapshots and their hashes;
- lifecycle action request + completion observations;
- verifier identity/version/code hash;
- verified-at / expiry;
- explicit nonclaims.

There must be no generic service-role RPC that accepts caller-supplied `verified=true`.

Candidate verifier classes:

- **AWS_EC2**: existing signed IID + CloudTrail verifier, unchanged.
- **GITHUB_CODESPACES**: requires an authenticated GitHub user-level Codespaces API verifier. The standard Actions `GITHUB_TOKEN` was proven insufficient (`403 Resource not accessible by integration`). A connected-chat PAT observation is diagnostic only until a production verifier capability exists.
- **VERCEL_SANDBOX**: a Vercel control deployment can use project-scoped Vercel OIDC and call Sandbox APIs directly. This may provide a legitimate authenticated verifier rail, but adopting named-snapshot persistence as W1 persistence is a semantic change and must be pair-resealed first.

### V2-C — persisted admission-candidate readback

An additive `h205f22_w1_admission_candidate_readback_v2` must compose only persisted rows and require all of:

1. current `VERIFIED` Linux safety verification bound to the post-lifecycle host probe;
2. provider-neutral backend binding;
3. authenticated provider verification receipt bound to the exact raw lifecycle receipt;
4. exact provider object identity stable pre/post;
5. provider session identity changes according to provider contract;
6. stable machine/workspace persistence identity and byte-identical sentinel where the provider contract uses a persistent workspace;
7. pre/post real Linux probe receipts satisfying the enrollment node-class capabilities;
8. required boot/runtime identity transition, with the semantic level explicitly named (host kernel vs provider VM vs container session); no ambiguous `boot_id` promotion;
9. chronology: pre probe < lifecycle request <= lifecycle completion < post probe <= safety verification;
10. no synthetic evidence, no caller-supplied authority fields.

The v2 readback output remains non-authority:

- `admission_candidate=true` only if every persisted predicate is satisfied;
- `worker_admitted=false`;
- `persistent_worker_proof=false` until the dedicated supervisor verification stage defines the accepted provider persistence grade;
- `w1_verified=false`;
- `canonical=false`;
- `authority_effect=false`.

### V2-D — supervisor verification remains separate

Do not conflate causal readback with W1 authority. The supervisor must independently re-read persisted evidence, check current roadmap/claim/semantic authority, and only then transition the milestone according to a separately sealed acceptance contract.

## Codespaces-specific live findings

- Stable GitHub Codespace object and `/workspaces` sentinel survived provider stop/start.
- Container runtime session changed.
- Bare Codespace failed the current host safety collector on NNP/seccomp/mount witness.
- A `--pid=host` nested Docker workaround was rejected because it weakens isolation and games the one-plane witness.
- Two-plane diagnostics later showed genuine mount namespace isolation without host PID sharing is possible.
- The H1-H13 prereq probe contained a confirmed UID-map ordering bug: parent UID/GID were captured after `CLONE_NEWUSER`, producing overflow UID/GID and false `EPERM`; a regression test now exposes this defect.
- Cgroup delegation/tree-kill remains a distinct predicate requiring honest evidence.
- Rootless semantics must be explicit. Docker's conventional rootless definition covers daemon and containers; UID 1000 inside a rootful daemon must not be silently promoted to `rootless=true`.

## Decision gate

Before any production DDL or provider mutation, GPT and GLM must pair-decide one of:

1. return to the existing AWS v1 path and provision a real EC2 host;
2. seal the additive provider-neutral v2 contract and implement provider-specific authenticated verification;
3. stop with a hard gate if neither path has a legitimate execution/verifier capability.

Vercel Sandbox is not a drop-in persistent W1 provider under current v1 semantics. Codespaces is not a drop-in v1 backend. Any contrary implementation would be a semantic bypass.
