# RSI R4 — merge-governance research-after checkpoint

Date: 2026-09-19  
Repository: `PatrickFrome/Compute`  
Source branch: `work/same-point-duel-v4-rsi-merge-governance`  
Source head before this research note: `d236efd8164079b78b8b54e0e84b77276a9d64d4`  
Authority: source-only, no Browser/scheduler/execution/promotion/self-update authority.

## Why this slice exists

The post-#821 audit established a structural failure mode: a large self-improvement payload reached `main` even though important checks were not terminal-green. The fix cannot be another advisory sentence in a PR. Merge admission itself has to become a deterministic, independently owned verifier.

The implemented source slice therefore adds a trusted-base PR contract and extends the authoritative `pull_request_target` governance workflow so that:

- `work/browser-final-2026-convergence-*` is a registered CROSS-CUTTING workstream in the authoritative gate, not only in the unprivileged preview;
- draft PRs must already bind exact workstream identity, assigned branch and semantic baseline;
- ready PRs additionally require the complete acceptance/risk fields and the evidence checklist;
- template comments, blank values, wrong Level-1 bindings, wrong assigned branch, unknown workstreams and non-`main` bases fail closed;
- governance executes the contract from the trusted base tree; PR-head code is fetched only as data and is never executed as governance authority;
- `ready_for_review` and `converted_to_draft` transitions re-evaluate the contract.

## Research-after

### ADOPT NOW — repository-enforced admission, not advisory CI

GitHub's protected-branch and ruleset model explicitly separates visible checks from enforceable merge requirements. Required status checks must succeed before merge only when branch protection or an active ruleset requires them. Rulesets can also require reviews, last-push approval and other PR conditions.

This directly matches the METAENGINE requirement: source-level governance is necessary but not sufficient. The repository currently exposes one repository ruleset, `w1-persistent-host-proof`, and its enforcement state is `disabled`. The available connector cannot mutate repository-administration rules, so this branch must remain non-terminal until an owner/admin activates a dedicated `main` evidence ruleset and it is read back.

Recommended external ruleset target:

- branch: `main`;
- enforcement: `active`;
- require pull request;
- require strict/up-to-date status checks;
- require the authoritative Compute Fabric Governance check and the exact-head RSI/Browser qualification checks selected for the final repair line;
- require at least one independent approval for trust-root/evaluator/governance changes;
- dismiss stale approvals and require approval after the last push where supported;
- no routine bypass actors;
- block force pushes and deletion.

Merge queue is useful only if repository ownership/plan supports it; it is not a prerequisite for R4.

Primary references:
- GitHub, protected branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub, ruleset rules: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- GitHub, creating rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository

### ADOPT NOW — frozen external acceptance for self-improvement

Self-Evolving Agents with Anytime-Valid Certificates argues for a versioned harness around a frozen base and an auditable external admission certificate under repeated self-modification. This supports treating GitHub merge admission as an external acceptor, not a signal the candidate may rewrite.

Source: https://arxiv.org/abs/2607.00871

### ADOPT NOW — treat harness tampering as a first-class regression

Auditing Harness Tampering in Self-Improving Agents reports that edits to authorization, provenance and completeness checks can create illusory gains and can persist in selected lineages. For METAENGINE this means changes to `.github/workflows/governance.yml`, promotion gates, evaluator roots and evidence contracts must themselves be treated as trust-root changes.

Source: https://arxiv.org/abs/2609.00069

### ADOPT NOW — contracts improve reviewability, not correctness by themselves

Software Delegation Contracts reports that explicit task/authority/evidence bundles improved reviewability even where objective task outcomes did not improve. This is exactly the role of the new deterministic PR contract: it makes the evidence package reviewable, but it does not replace exact-head tests or external evaluation.

Source: https://arxiv.org/abs/2606.17099

### ADOPT NOW — independent verifier quality is a separate optimization plane

Agentic Evolution finds the strongest autonomous self-improvement results where deterministic verifiers independent of the evolving system are available; proxy/self-referential signals degrade with iteration. ReVeal shows strong self-verification can improve search and code generation, but that is best used as proposer feedback, not as the final acceptance authority.

Sources:
- https://www.microsoft.com/en-us/research/publication/agentic-evolution-from-self-improving-agents-to-co-evolving-human-ai-systems/
- https://www.microsoft.com/en-us/research/publication/reveal-self-evolving-code-agents-via-reliable-self-verification/

### ADOPT NOW — test the verifier itself

Building to the Test shows near-perfect hidden-test scores can coexist with missing requested artifacts; mechanical artifact audit and no-op ablation reveal this failure. MORPHAGENT shows trace-based metamorphic relations can test agent invariants without one brittle expected output.

For governance, the immediate metamorphic suite is:

1. change only `Assigned branch` -> exact branch mismatch;
2. change only Level-1 -> exact milestone mismatch;
3. convert draft -> ready with one unchecked evidence item -> merge-ineligible;
4. replace one real field with the template comment -> missing field;
5. change base from `main` -> base failure;
6. keep every semantic value fixed while changing whitespace/Markdown dash prefix -> same verdict.

Sources:
- https://www.microsoft.com/en-us/research/publication/building-to-the-test-coding-agents-deliver-what-you-check-not-what-you-requested/
- https://ieeexplore.ieee.org/abstract/document/11662476/

### ADOPT NOW — least privilege at every boundary

Microsoft's 2026 agent security guidance recommends explicit identities, narrow roles/tool bindings, per-call authorization re-checks and end-to-end auditability. The governance workflow follows that pattern: read-only repository authority, trusted-base execution, PR head treated as data, no Browser/runtime authority.

Source: https://www.microsoft.com/en-us/security/blog/2026/07/16/least-privilege-for-ai-agents-identity-access-and-tool-binding/

## Deferred

- Self-generated tests as final acceptance authority.
- Candidate-controlled changes to required-check names or ruleset policy.
- Automatic merge or auto-promotion from this governance workflow.
- Merge queue until repository eligibility is verified.
- Any claim that the source workflow alone mechanically blocks an administrator while the repository ruleset is not active.

## Exact next gate

1. Exact-head CI for PR #878.
2. Read back the authoritative `pull_request_target` run, not only Governance Preview.
3. Activate and read back an enforceable `main` ruleset through an admin-capable channel; this connector has read-only ruleset access.
4. Re-run the gate on a ready test PR and prove a deliberately failed required check cannot merge.
5. Only then classify R4 merge governance as mechanically enforced.
