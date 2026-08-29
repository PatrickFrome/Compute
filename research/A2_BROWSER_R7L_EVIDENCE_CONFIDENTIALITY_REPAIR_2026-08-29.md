# A2 Browser R7L — Evidence Confidentiality Repair

Date: 2026-08-29
Parent candidate: `5b1f114b2c5533a560e5284c545d4392a268d589`
Parent verified runtime: R7K `cbdb70e9be5a99251d57a7be7d0c43a95683ebae`

## Problem

Exact-head R7L run `33229778140` was green, but independent inspection of uploaded artifact `9708105850` found that `R7L_EXEC_IDENTITY.trace` recorded the launcher `execve` environment in full. The workflow invoked `strace` with `-v`; upstream strace documentation defines `-v`/`--no-abbrev` as printing unabbreviated environment data. On a hosted CI runner that can serialize credential-bearing environment entries into a retained evidence artifact.

No credential value is reproduced in this document. The affected artifact is evidence-contaminated and must not be used for authoritative promotion even though its behavioral tests passed.

Classification: `EVIDENCE_GATE` + `SECURITY`.

## Candidate approaches

### A. Redact known values after tracing

SECURITY: medium. A deny-list can miss newly introduced credential names or non-token sensitive values.

RELIABILITY: medium. Redaction becomes coupled to runner implementation details.

Decision: reject as the primary boundary.

### B. Remove `strace -v`

SECURITY: high for the observed leak because environment arrays remain abbreviated by default.

RELIABILITY: medium. It weakens the existing runtime observation that helper `execveat` receives exactly an empty environment unless another proof is added.

Decision: reject as a standalone repair.

### C. Trace under an explicitly empty environment plus one synthetic sentinel

SECURITY: high. The tracee cannot inherit CI credentials, so even verbose syscall decoding has no credential values to serialize.

RELIABILITY: high. The synthetic sentinel still proves that the launcher receives non-empty ambient environment and that `fexecve` transfers an empty `envp` to the helper.

TCB SIZE: unchanged production TCB; workflow-only change.

SUPPLY CHAIN: zero new dependencies.

Decision: choose.

### D. Stop retaining syscall traces

SECURITY: high for confidentiality, but removes the strongest exact-runtime ordering evidence for `close_range -> PR_SET_NO_NEW_PRIVS -> openat2 -> execveat(AT_EMPTY_PATH)`.

Decision: reject.

## Decision

Run the traced launcher from `env -i` with only `A2_R7L_ENV_SENTINEL=must-not-cross-exec`, while retaining verbose `strace` decoding. Pass absolute resolved paths for `bash` and `strace` so the empty environment does not require `PATH` authority.

The runtime verifier must then require all of the following:

1. the launcher `execve` line contains the synthetic sentinel;
2. no GitHub Actions / runner credential marker is present anywhere in the retained trace;
3. the FD-bound helper `execveat(..., AT_EMPTY_PATH)` line has an exactly empty environment array;
4. the existing ambient-FD-cut, `no_new_privs`, confined `openat2`, FD-bound exec, helper close-range, and no-pathname-exec ordering checks remain unchanged.

The repair document itself is included in the deterministic R7L tar so provenance binds the decision and the evidence-safety gate to the exact candidate.

## Why

This fixes the evidence producer rather than trying to clean a contaminated artifact after the fact. It preserves the security-relevant runtime proof while removing CI credentials from the trace input domain entirely. It also makes failure deterministic: if future workflow changes reintroduce runner credential markers, evidence construction fails closed before upload/attestation.

## Rejected alternatives

- post-hoc redaction: incomplete by construction;
- dropping verbose decoding without replacing the empty-env proof: weaker evidence;
- dropping syscall evidence: loses direct runtime ordering proof;
- changing launcher/runtime code: wrong layer; production behavior was not the leak source.

## New invariants

- `EVIDENCE_TRACE_INPUT_ENV_IS_SYNTHETIC_ONLY`.
- `CI_CREDENTIALS_NEVER_ENTER_RETAINED_RUNTIME_TRACE`.
- `HELPER_EXEC_ENV_IS_PROVEN_EXACTLY_EMPTY`.
- `EVIDENCE_CONFIDENTIALITY_FAILURE_BLOCKS_PROMOTION`.
- `R7L_PRODUCTION_TCB_UNCHANGED_BY_EVIDENCE_REPAIR`.

## Explicit non-claims

- This does not retroactively sanitize or revoke previously uploaded evidence artifacts.
- This does not claim GitHub hosted-runner credentials are long-lived; evidence must be safe regardless of credential lifetime.
- This does not change Node integration, browser authority, network authority, or actuation authority.
- R7L remains `CANDIDATE` until the repair commit itself receives exact-head green CI, runtime proof, deterministic artifact digest, and provenance attestation.