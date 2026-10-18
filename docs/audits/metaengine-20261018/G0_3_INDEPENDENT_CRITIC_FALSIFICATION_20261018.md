# METAENGINE G0.3 — Critic falsification packet and review request

**Date:** 2026-10-18. **Base SHA:** 757404a3c4aff485abd7bad4f49f035e2ee85bde (PR #1321, on G0.1 PR #1320). **Decision:** REVIEW_REQUEST_PREPARED / FALSIFICATION_FOUND / INDEPENDENT_REVIEW_PENDING. G0 stays IN_PROGRESS. This document is an evidence classification challenge, NOT an independent Critic approval.

## 1. Review availability and independence

- GitHub PR #1320 and #1321 each had zero submitted reviews at this reading. Neither source author nor this assistant may self-approve the same evidence as an independent Critic.
- Native DevFleet Direct read-only fleet_list returned HTTP 429 UNAVAILABLE. No ChatGPT Critic task was assigned, no tab was created, and no completion claim is warranted.
- Local GitHub CLI is unavailable; the connected GitHub workflow provider filters PR-triggered runs and returns a first page. The mismatch between 12 retrieved workflows and an earlier count of 13 is unresolved.
- An external reviewer must independently examine the exact source SHA and the two reports. This report records local adversarial checks, but the checks were performed by the same assistant and cannot satisfy separation-of-duties.

## 2. Material falsification: G0.2 understated actual W52 production registration

F1 SOURCE-CORRECTION-REQUIRED. In apps/metaengine-browser/src/main.mjs:2127, production initNativeSupervisor() passes trustedNativeOwnerReaders: createHostNativeOwnerReadersW60(...) to NativeSupervisorClient. In apps/metaengine-browser/src/native-supervisor-client.mjs:566-567, the constructor passes those readers into createNativeOwnerVerifierW52().

Therefore saying that W52 has no production consumer or that all six W52 callbacks are simply absent *in production* is too broad. The correct finding is that W52 production ADAPTER REGISTRATION EXISTS, but the necessary authenticated producer outputs and real Owner genesis are not demonstrated for the installed client. Source-only default-construction tests without readers show a valid fail-closed behavior, not that the real main constructor never registers readers.

This does NOT disprove the central missing-authority finding. A repository-wide code search finds bindHostOwnerGenesisW74 used only by its definition in supervisor-device-identity.mjs:332 and a test in host-owner-protected-identity-w74.test.mjs:49; no tracked production main call. Meanwhile final-runtime-activation.mjs:162 and host-agent-remote-composition.mjs:97 create W76 custody with identity only, without private gateway/own-PG birth/backup root closures. Those remain source-supported defects.

An isolated read-only six-check source assertion on this SHA gave 6/6 PASS: real W60 main injection, W52 verifier instantiation, W74 method definition, no main caller, and the two W76 identity-only construction sites. Do not overinterpret a static search as whole-program reachability proof; dynamic injection still requires production runtime qualification.

## 3. G0.1/G0.2 adversarial checklist for a genuinely separate Critic

| Challenge | Source/test evidence to inspect | Required safe judgment |
| --- | --- | --- |
| C1: SHA provenance | e35da14 and 757404a parent ancestry, clean worktree, exact Git blob versions | Do not inherit physical packages or CI greens from a docs-only SHA |
| C2: incomplete CI events | 7eaa00f PR-only 12 runs (3 success/8 failure/1 cancelled); earlier 13-run report | Mark full enumeration UNKNOWN unless authenticated independent Actions list reconciles |
| C3: installed-vs-source | NotSigned installed QA EXE, owner pin 8e72494a... vs bundle a9becd9d... | No signed release or Owner migration claim. Existing older package remains mismatched |
| C4: W52 consumer correction | main.mjs:2127, native-supervisor-client.mjs:566-567 | W52 REGISTERED, trusted output UNKNOWN; correct earlier oversimplification |
| C5: W74/W76 consumer gap | supervisor-device-identity.mjs:332 and test-only reference; final-runtime-activation.mjs:162 and host-agent-remote-composition.mjs:97 | W74 production bind unverified/absent in tracked sources; W76 default private providers missing |
| C6: Guardian precise birth | OS read Guardian PID3396 failed, C++ FILETIME code exists, tests passed | OS timestamps do not substitute for authenticated native W75 challenge |
| C7: PG17 readback | own-postgres-birth-w61.mjs and source 7/7 PASS, port 55432 process | Owner-bound SQL scope, leases, restart and recovery must stay UNKNOWN without actual attached PG evidence |
| C8: source test claims | W52/W74/W76 17/17, W61 7/7 | Mark source-negative checks PASS; installed runtime equivalence NOT PROVEN |
| C9: ACL / identity | G0.1 coarse Get-Acl (AreAccessRulesProtected=False) | Neither declare native ACL PASS nor infer ACL exploit from a single coarse flag |
| C10: security boundaries | No secrets printed, no SQL query, no service mutation | Keep release signer, credential rotation, revoke and AMBIGUOUS lease status UNKNOWN |

## 4. Independent decision contract

A legitimate Critic response must identify the exact reviewed SHA and file/line evidence, explicitly ACCEPT/REQUEST_CHANGES/BLOCKED for G0 *evidence enumeration*, list all unknowns, and never convert an unverified installed trust assertion to PASS. It must correct F1 rather than quietly deleting it. An actual APPROVE may advance G0 to EVIDENCE_READY only after its requested changes are incorporated and accepted; G1/G2 remain blocked by signed provenance and native Owner/Guardian/PG requirements. A reviewer without access to an authenticated producer must state UNKNOWN.

**Current action:** REQUEST_REVIEW; no review approval received. **Current gate status:** G0 IN_PROGRESS, G1/G2 BLOCKED. **NEXT:** independent Critic review of this packet and source/doc SHA; explicit decision with no shortcut. Once recorded, correct any substantiated source/document inconsistencies in a narrow PR, and only then decide whether G0 can advance.

## 5. Boundaries and sources

No installed Browser, Guardian, PostgreSQL, Owner descriptor, secret, OS policy, package version, credential or runtime state was modified in G0.3. No new scheduler, synthetic attestation or automatic retry was introduced.

- [G0.1 read-only evidence report](./G0_1_EXACT_HEAD_INSTALLED_CI_EVIDENCE_20261018.md)
- [G0.2 native source boundary review](./G0_2_NATIVE_PRODUCER_BOUNDARY_REVIEW_20261018.md)
- [Audit closure register](../../../coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md)
- [Unified Roadmap](../../../coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md)
- [PR #1320](https://github.com/PatrickFrome/Compute/pull/1320), [PR #1321](https://github.com/PatrickFrome/Compute/pull/1321)