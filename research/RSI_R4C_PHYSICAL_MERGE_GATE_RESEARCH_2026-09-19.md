# RSI R4C — Physical Merge Gate Research

Date: 2026-09-19  
Parent: PR #882 @ `42c48779d83863213d87cb7a40efa6fbd46acc11`  
Implementation branch: `work/metaengine-rsi-r4-physical-merge-gate-v1-sol`

## Problem

A trusted-base governance workflow can correctly reject malformed or self-authorizing RSI pull requests, yet the existence or success of that workflow is not itself proof that GitHub mechanically prevents a merge when the check is absent or failing.

Live repository readback on 2026-09-19 shows:
- `main` is marked protected;
- the branch summary exposes no required status-check contexts;
- the repository ruleset collection contains one ruleset, `w1-persistent-host-proof`, and its enforcement is `disabled`;
- no active repository ruleset was observed requiring the authoritative `governance` check on `main`.

R4C therefore formalizes a read-only proof boundary. It does not mutate GitHub administration.

## Research

### GitHub required status checks
Sources:
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

GitHub documents that required status checks are the mechanism that blocks collaborators from merging until selected checks pass. If required status checks are disabled, collaborators may merge regardless of the check result. Rulesets only take effect when their enforcement status is Active.

**ADOPT_NOW:** treat repository-side required-check configuration as the mechanical proof. Workflow existence, workflow source correctness and a green run are necessary evidence but not substitutes for merge enforcement.

### GitHub check identity and merge queues
Source:
- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks

GitHub requires the latest relevant commit to report the required check, and merge queues require compatible `merge_group` triggers when required checks are used with the queue.

**ADOPT_NOW:** freeze the authoritative check identity (`governance`) and validate the exact live repository rule that requires it.  
**DEFER:** merge-queue enforcement until a merge queue is actually adopted; at that point add and test `merge_group` explicitly rather than assuming `pull_request_target` covers it.

### SLSA Source v1.2
Source:
- https://slsa.dev/spec/v1.2/source-requirements

SLSA distinguishes documented policy from SCS-enforced technical controls. Claims such as “all consumable revisions were tested before acceptance” need enforcement by the source-control system, not only a convention in repository code.

**ADOPT_NOW:** R4 completion requires externally read repository enforcement evidence. A candidate branch cannot certify its own merge-admission mechanism.

### Auditing Harness Tampering in Self-Improving Agents
Source:
- https://arxiv.org/abs/2609.00069

Harness tampering can compromise authorization, provenance and completeness while preserving apparently improved scores. A self-improvement candidate that can weaken or bypass the acceptance harness can create false progress.

**ADOPT_NOW:** keep the governance contract on trusted-base execution and separately prove that GitHub requires the resulting check. Candidate changes to the check name or enforcement predicate cannot count as proof.

### Self-Harness
Source:
- https://arxiv.org/abs/2606.09498

Self-Harness demonstrates that automatically proposed harness changes can be useful when acceptance is separated from proposal and guarded by regression validation.

**EXPERIMENT:** allow RSI agents to propose governance improvements on isolated branches. Their proposals remain untrusted until the existing external governance verifier and repository enforcement layer accept them.

### in-toto
Source:
- https://in-toto.io/docs/getting-started/

in-toto separates owner-defined layouts from evidence emitted by authorized functionaries.

**ADOPT_LATER:** represent GitHub ruleset/branch-protection readback as an external attestation/functionary input to R4. This is stronger than letting a PR body or candidate-controlled file claim that the merge gate is active.

## Decision

### ADOPT_NOW
1. Read-only physical-gate classifier.
2. Exact repository + target branch binding.
3. Frozen authoritative check name `governance`.
4. Proof only from a required branch-protection context or an Active targeting ruleset.
5. Disabled rulesets and wrong-target rulesets never count.
6. Ruleset bypass actors prevent an “absolute enforcement” claim.
7. Workflow-green alone is explicitly insufficient.

### EXPERIMENT
- candidate-proposed governance/harness improvements, isolated from current acceptance authority;
- signed repository-enforcement attestations once an external attestation channel exists.

### DEFER
- merge queue adoption;
- automated ruleset provisioning until an administration-capable trusted channel is available and independently read back;
- organization-level ruleset aggregation if/when organization governance is introduced.

### REJECT
- declaring R4 complete because `.github/workflows/governance.yml` exists;
- declaring R4 complete because a governance workflow run is green while the check is not required;
- allowing a candidate to choose the required check name;
- treating a disabled ruleset as enforcement;
- silently weakening the gate to accommodate unavailable repository-admin permissions.

## Result

R4 now has two distinct questions:

1. **Does the trusted-base governance verifier classify the PR correctly?** — PR #882.
2. **Will GitHub physically reject a merge unless that verifier passes?** — R4C live-enforcement evidence.

Both must be true before the system can claim mechanically enforced merge governance.
