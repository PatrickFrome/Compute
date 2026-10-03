# Agent result transcript research

Date: 2026-10-03. Scope: source-only Browser result harvesting.

## Roadmap binding

Canonical Level-1 owner: C2, First Serial Coding Loop. Acceptance criterion:
repo -> edit -> build/test -> independently verified artifact. Client Level-2
workstream: C4_TYPED_PRODUCT_CONTROL supporting C5 useful verified work and
restart. This slice repairs an existing observation boundary on that path;
it introduces no scheduler or execution authority and does not close C2/C5.

## Verified starting point

`29d76d8f51bbb307d74f55a306223445516875d1` passed source qualification
37101948651 on ubuntu-24.04 and windows-2025. Canonical Package Smoke builder
validation is retained.

Physical candidate `a68774eb6ad5a0fe8014501163b0c67f608bed09` has ten physical
workflows with terminal success, push event, attempt 1. Package Smoke producer
37087347663 built version `0.7.0-dev.37086632570.1`. Candidate artifact 11260817954
is separate from this source successor.

Downloaded proof archives 11261117931 and 11261401099 were SHA-256 checked
against GitHub artifact metadata. Package and SLSA evidence agree on source,
installer name, version and installer digest
`937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`.
Build Identity V3 is
`f7d78fdaf7b89028341cc4d0ceb7a7f73ead9b3a323fc15d1560563d7d0c478c`.
The installer bytes were not downloaded/rehashed in this slice; the digest is
read from the verified producer proof archive and matching SLSA evidence.

## Reproduced defects

1. `captureTranscript` stopped its AX census when the requested page filled.
   A first 2,000-character page therefore reported the prefix length as the
   conversation total. Multi-node replies hid their final result block.
2. The task cycle used that 2,000-character head for every transcript up to
   20,000 characters. Even a truthful total could not repair this branch.
3. The protocol prompt contained a valid exact-task READY/ACCEPT example.
   Prompt-only text parsed as CLAIM_BOUND; prompt plus an actual result parsed
   as AMBIGUOUS. The runtime could write RESULT_READY without an answer.
4. The old 240,000-character cap bounded reported size but could expose bytes
   beyond that cap. Truncation was not distinguished from a complete census.

The new AX/task-cycle behavioral cases failed nine of eleven cases before the
fix. Separate primary and critic self-echo reproductions failed before the
template repair. These are controlled SYNTHETIC evidence, not live z.ai work.

## Implementation inference

CDP Accessibility.getFullAXTree returns an AX-node collection. METAENGINE owns
the text projection and its pagination contract. Therefore page size must limit
the returned page independently of the bounded census, and an incomplete
census must not be represented as a complete latest answer.

The existing observation path now censuses up to the established 240,000 cap,
marks omitted text explicitly and reads the final 20,000-character window.
Truncated or changing observations cannot supply a result/tool claim. Prompt
templates use an invalid disposition placeholder until the model supplies one
allowed disposition; the template alone cannot be a result.

No claim parser, receipt schema, database function, effect delivery journal or
lease authority is replaced. A lost completion acknowledgement continues to
use durable status readback without resending a Browser effect.

## Primary-source research

- [CDP Accessibility domain](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/):
  AXNode IDs, parent/child links and backend DOM IDs are observation material.
  They do not by themselves certify assistant-message authorship. The local
  pagination repair is an implementation inference from that API contract.
- [AWS Builders' Library: idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/):
  persist one operation identity with the effect and reject changed intent
  using the same identifier. Preserve the existing request/effect journal.
- [etcd: comparison with other stores](https://etcd.io/docs/v3.5/learning/why/):
  lease expiry alone does not fence an external resource. Exact generation
  checks belong at effect and result acceptance boundaries.
- [Microsoft asynchronous request-reply](https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply):
  a stable operation/status resource supports recovery after lost responses.
- [Temporal workflow execution](https://docs.temporal.io/workflow-execution):
  durable history/recovery is applicable; another workflow engine is unnecessary.
- [Z.ai Function Calling](https://docs.z.ai/guides/capabilities/function-calling):
  application execution and returned tool results remain distinct from model
  requests. This API documentation does not establish chat.z.ai SPA DOM contracts.
- [SLSA verification](https://slsa.dev/spec/v1.2/verifying-artifacts):
  consumer verification binds trusted builder and exact artifact expectations.
  A green supply-chain matrix does not verify the application's useful work.

## Next blocker and acceptance boundary

READ_TRANSCRIPT still mixes page/prompt/model AX text and loses message author
identity. The template repair closes its own self-echo only. A caller-authored
valid block can still look like model output. Before closing useful-work proof,
bind the latest assistant response to the exact conversation, target/process,
current lease and causal generation; fail closed when authorship is ambiguous.
Do not infer authorship from a role-name heuristic or from generation stopping.

The current C4 physical harness waits only for Agent-origin transport proof;
its result boolean can represent primary READY. Reuse existing
meta-orchestrator sequencing, which requires VERIFIED before a successor.
C5 needs independent critic acceptance of the exact task/result digest plus
worktree/diff and real failing-to-passing test evidence, durable VERIFIED
readback, restart recovery and a subsequent independent cycle.

Physical activation of this changed runtime needs a fresh source/version and
the complete one-producer matrix. No consumed package identity may be rebuilt.
