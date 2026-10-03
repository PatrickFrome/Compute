# Agent result transcript source checkpoint

Date: 2026-10-03 (Europe/Moscow).
Branch: `work/client-v1-agent-result-transcript-tail-v1`.
Parent: `29d76d8f51bbb307d74f55a306223445516875d1`.
Classification: SOURCE_IMPLEMENTED / SYNTHETIC_CONTRACT_VERIFIED.

## Roadmap and claim

Level-1: C2 First Serial Coding Loop, real edit/test/verified artifact acceptance.
Client Level-2: C4_TYPED_PRODUCT_CONTROL supporting C5 useful verified work and
restart. This is a workstream checkpoint, not a sealed mainline checkpoint or
a claim that C2/C4/C5 physical acceptance is complete.

## Baseline verified again

Parent canonical-builder source qualification 37101948651 completed SUCCESS
on Linux and Windows, attempt 1. Physical V3 source
`a68774eb6ad5a0fe8014501163b0c67f608bed09` retains 10/10 physical SUCCESS at
push/attempt 1. Producer 37087347663 is the sole Package Smoke build.
Qualified version: `0.7.0-dev.37086632570.1`.
Candidate artifact: 11260817954.

Package proof archive 11261117931:
`sha256:917bc78714528dc26e744efab8cb96d814d291929f7d4b7990b3893161d8c69d`.
SLSA verification archive 11261401099:
`sha256:6614a8fa2ccd358bbe1d423845912578d6a194c997eeb736a6222fd610d20331`.
Both downloaded archive hashes match current GitHub metadata. Their installer
name, source and digest agree. Installer digest recorded in those proofs:
`937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`.
Installer bytes were not rehashed here.

## Implemented behavior

- AX census is independent of requested page size, capped at 240,000 chars;
  omitted text is explicit and output cannot exceed the retained census.
- Task completion reads the actual final 20,000 chars instead of a 2,000-char
  prefix. Truncated or changing census/tail observations cannot supply claims
  or issue model-requested tools.
- Prompt examples cannot parse as READY/ACCEPT claims; one actual result remains
  uniquely bound when the prompt is present in the transcript.
- Existing exact task/lease/conversation bindings, read-only claim flags and
  durable completion-status recovery remain in force.

## Verification at publication

Original transcript behavioral set: 2 PASS / 9 FAIL before repair.
Original primary/critic template: prompt-only produced RESULT_READY and
prompt-plus-result produced AMBIGUOUS in a controlled runtime reproduction.
Growth/shrink mutation tests also failed before the final drift guard.

Complete local Browser regression before the final drift addition: 4,011 PASS,
0 FAIL, 0 SKIP. Final focused root verification: 47 PASS, including all 15 new
transcript cases and 8 new template cases. Independent SLSA verifier: 10 PASS.
Changed source syntax, new workflow YAML and whitespace checks PASS.
Local Node is v24.19.0; remote qualification pins v24.21.0 on Ubuntu and Windows.

Exact published-head remote qualification is pending at this source checkpoint.
Its terminal run evidence belongs in a separate observation artifact, so the
tested source SHA need not be mutated to insert its own future run identity.

## Publication / physical boundary

This source branch uses a dedicated push-only, read-only qualification workflow.
The existing Browser pull_request path launches Package Smoke regardless of
draft state. Opening a runtime PR with the already-consumed package version
would start a prohibited duplicate build attempt. Therefore this slice is
published as a reviewable source branch and comparison; a runtime draft PR is
deferred until a fresh physical source/version is prepared. No CI gate is removed
and no previously qualified installer is rebuilt to satisfy PR mechanics.

No production DB/Edge deployment, release, tag, merge, promotion, admission
change, user-machine installation or external Agent submission is performed.

## Next blockers

1. Flat AX text does not prove assistant-message origin. A user-authored valid
   claim can still be parsed. Capture an actual native Agent AX/DOM fixture and
   positively bind assistant wrapper ancestry to current conversation/target,
   post-dispatch runtime revision and lease; ambiguous authorship must block.
2. Absence of a named stop control is not positive generation-completion proof.
   Establish a real Agent terminal response observation before useful-work exit.
3. C5 requires real coding artifacts/tests, independent exact-digest acceptance,
   durable VERIFIED readback, restart recovery and a subsequent cycle. Existing
   C4 transport/readback boolean and green package CI do not close that gate.

Research: `research/METAENGINE_CLIENT_AGENT_RESULT_TRANSCRIPT_RESEARCH_2026-10-03.md`.
