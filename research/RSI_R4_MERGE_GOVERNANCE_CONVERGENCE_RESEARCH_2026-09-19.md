# RSI R4 — merge-governance convergence research-after

Date: 2026-09-19  
Repository: `PatrickFrome/Compute`  
Base lineage: PR #871 -> PR #880  
Convergence branch: `work/same-point-duel-v4-rsi-governance-contract-v2-gpt`  
Source head before this note: `15fe50f28794221eff98efdb193ed24c38533eac`

## Convergence decision

Two valid R4 implementations appeared concurrently:

- PR #871 registered `work/browser-final-2026-convergence-*` in authoritative governance and made key roadmap fields non-empty.
- PR #880 hardened that validator against multiline/malformed HTML placeholder comments.
- PR #878 independently added a deterministic reusable PR contract, draft-vs-ready semantics, exact assigned-branch binding, complete ready evidence requirements, falsification tests and post-step research.

The correct action is semantic convergence, not choosing one branch wholesale. This branch starts from #880 and adopts the non-duplicating #878 properties into one deterministic contract. The inline Python validators are removed in favor of one pure module. The authoritative `pull_request_target` path executes it only from trusted base; the `pull_request` preview may execute head code but remains explicitly non-authoritative.

## Research-after conclusions

### ADOPT NOW — active repository rules are the mechanical boundary

GitHub documents that a status check becomes a merge requirement only when branch protection or an active ruleset requires it. Rulesets can require status checks and reviews; strict checks can require the branch to be current with its base. Therefore the source workflow is necessary but cannot honestly be called a non-bypassable merge blocker until a repository-admin rule targets `main`.

Observed live repository state: the repository rulesets endpoint exposes `w1-persistent-host-proof` with `enforcement=disabled`. The current connector can read rulesets but does not expose administration writes. R4 remains source-qualified / external-rule-blocked until an admin-capable channel activates the exact rule and a failed required check is experimentally shown to block merge.

References:
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository

### ADOPT NOW — frozen external acceptor for evolving agents

SEA's anytime-valid certificate architecture makes a useful distinction for METAENGINE: the system may explore and improve broadly, but admission remains outside the candidate and emits auditable evidence. Repository merge governance is one of those external acceptors and must not be writable by the normal RSI candidate path.

Reference: https://arxiv.org/abs/2607.00871

### ADOPT NOW — governance is part of the harness attack surface

Auditing Harness Tampering in Self-Improving Agents shows that edits to authorization, provenance and completeness checks can create apparent gains and persist in successful lineages. Consequently a governance-workflow change is itself a trust-root change. METAENGINE's existing self-authorization fence is preserved, and governance branches remain restricted to pre-authorized paths.

Reference: https://arxiv.org/abs/2609.00069

### ADOPT NOW — evidence bundles improve reviewability, not truth

Software Delegation Contracts found that explicit authority/evidence bundles materially improve reviewability, while not necessarily improving objective correctness. This supports the new PR contract, but also means the contract must never replace independent exact-head qualification.

Reference: https://arxiv.org/abs/2606.17099

### ADOPT NOW — verifier health must be falsified

Building to the Test demonstrates that passing a hidden test oracle can coexist with a missing requested artifact; no-op ablation and mechanical audits expose the gap. MORPHAGENT demonstrates useful metamorphic relations for agentic systems.

The R4 contract therefore has explicit metamorphic/negative cases:
- same semantics with optional Markdown dash -> same verdict;
- exact assigned-branch mutation -> fail;
- exact Level-1 mutation -> fail;
- draft->ready with one missing evidence item -> fail ready admission;
- single-line or multiline template comment -> missing field;
- malformed HTML comment -> fail closed;
- `main`->other base -> fail;
- unknown workstream -> fail.

References:
- https://www.microsoft.com/en-us/research/publication/building-to-the-test-coding-agents-deliver-what-you-check-not-what-you-requested/
- https://ieeexplore.ieee.org/abstract/document/11662476/

### ADOPT NOW — self-verification is search feedback, not promotion authority

ReVeal provides evidence that stronger iterative self-verification can improve code generation and test-time search. Agentic Evolution finds autonomous improvement is strongest when deterministic verifiers are independent of the evolving policy. Together they support the METAENGINE separation: candidate/self-verification may improve proposals, but authoritative merge and promotion gates remain externally owned.

References:
- https://www.microsoft.com/en-us/research/publication/reveal-self-evolving-code-agents-via-reliable-self-verification/
- https://www.microsoft.com/en-us/research/publication/agentic-evolution-from-self-improving-agents-to-co-evolving-human-ai-systems/

### ADOPT NOW — least privilege and re-check at every effect boundary

Microsoft's 2026 agent least-privilege guidance recommends dedicated identities, task-scoped roles/tool bindings and downstream re-authorization. The R4 workflow keeps `contents: read`, executes no PR-head code in the authoritative path, and does not acquire Browser, scheduler, execution or promotion authority.

Reference: https://www.microsoft.com/en-us/security/blog/2026/07/16/least-privilege-for-ai-agents-identity-access-and-tool-binding/

## External ruleset target

When an admin-capable channel is available, create/activate a dedicated `main` ruleset with:

- active enforcement;
- required pull request;
- no routine bypass;
- required authoritative governance check;
- exact-head critical/runtime/shell/self-update qualification checks selected for the canonical final line;
- strict up-to-date checks;
- independent approval for trust-root/evaluator/governance changes;
- stale-review dismissal / last-push approval where available;
- force-push and branch deletion blocked.

Merge queue is optional and should only be adopted if repository ownership/plan supports it.

## Terminal condition for R4

R4 is terminal only when all are true:

1. the converged exact source head is CI-green;
2. authoritative `pull_request_target` runs from trusted base;
3. an active `main` ruleset is read back with required checks/review semantics;
4. a deliberate required-check failure is proven unable to merge;
5. the evidence is appended to the DB without rewriting older checkpoints.

Until then: `eligible_for_promotion=false`.
