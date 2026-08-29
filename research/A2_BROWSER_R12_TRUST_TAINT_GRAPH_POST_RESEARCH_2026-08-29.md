# A2 Browser R12 — Trust / Taint Graph — Post-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R11 `d768954aa541e5927ddf14d5bb751a9a7620a6aa`
Initial implementation: `401f0d8f4f9d619883502645a7f254162a9aa994`
Initial green gate: `6bceae8cf2f314fd1b49211d048d03fb595a1ba2`, workflow `33237558108`

## Result

R12 implements deterministic provenance and integrity flow without granting browser, network, process, model or secret authority to the graph itself.

External/page/model/tool/file/message inputs are typed as untrusted sources. Transformations conservatively preserve the union of taint sources and cannot manufacture authority. Trusted authority and untrusted data are separate inputs at privileged sinks. Tainted browser arguments remain usable as data but force `live_revalidation_required=true`.

Scoped endorsement is the only integrity-upgrade path. It requires an injected trusted verifier, grants only explicit sink scopes, retains original taint provenance and produces an auditable endorsement object. Failed verification creates no endorsed node.

## Research re-check

OWASP's prompt-injection guidance recommends treating model behavior as untrusted at privilege boundaries, segregating external content, enforcing least privilege in deterministic application code, and using model-based guards only as defense in depth. This directly supports R12's separation of data provenance from authority rather than asking another model whether tainted content is safe.

Classical information-flow-control systems such as Jif distinguish integrity endorsement from ordinary data transformation. Endorsement is an explicit authority-bearing downgrade/upgrade operation subject to authority and robustness constraints, not an implicit consequence of parsing or summarization. R12 follows the same structural rule: derivation never clears taint and only explicit verified endorsement may create scoped authority eligibility.

## Verification interpretation

The first CI gate passed all R12 adversarial tests plus R11/R10/R9/R8 regressions. The implementation has zero browser/network/process primitives and adds no source dependency package.

The design deliberately allows tainted data to participate in a privileged operation *as data* when a separate trusted authority node authorizes the exact sink. This is necessary for browser automation: page-derived semantic targets are inherently untrusted but must still be usable after live revalidation. The data lane therefore never contributes authority.

## Confirmed invariants

- `PAGE_MODEL_TOOL_DATA_NEVER_GRANTS_AUTHORITY`.
- `TAINT_PROVENANCE_IS_MONOTONIC_ACROSS_DERIVATION`.
- `AUTHORITY_AND_DATA_ARE_SEPARATE_SINK_INPUTS`.
- `PRIVILEGED_SINK_CHECK_IS_DETERMINISTIC_CODE`.
- `REQUESTED_CAPABILITIES_MUST_BE_MINIMAL_SUBSET`.
- `ENDORSEMENT_IS_EXPLICIT_SCOPED_AND_AUDITABLE`.
- `ENDORSEMENT_RETAINS_UNTRUSTED_PROVENANCE`.
- `TAINTED_BROWSER_ARGUMENTS_REQUIRE_LIVE_REVALIDATION`.
- `TRUST_TAINT_GRAPH_HAS_ZERO_ACTUATION_AUTHORITY`.

## Explicit non-claims

R12 does not prove arbitrary semantic correctness of model/page data, does not sanitize prompt injection by itself, does not grant an endorsed node capabilities outside its explicit scopes, and does not replace R8 live browser revalidation or user/supervisor authority gates.

## R13 handoff

R13 should make execution history replayable without re-executing effects. A trace must bind source commit, action/taint evidence, deterministic decisions and terminal receipts while treating browser/network effects as recorded observations. Replay must be observational/deterministic validation only: it must not call browser, network, model or process effectors, and ambiguity must remain ambiguity rather than being normalized into success.
