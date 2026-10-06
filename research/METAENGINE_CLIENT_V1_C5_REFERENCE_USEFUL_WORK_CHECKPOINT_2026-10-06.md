# METAENGINE Client V1 C5 — Reference Useful-Work Producer Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — SYNTHETIC PHYSICAL REFERENCE / NON-LIVE**  
Branch: `work/client-v1-c5-reference-producer-v1`  
Qualified implementation head: `8e278110f650ac19929acba1c58eac58c3b7bcf9`

## Roadmap reconciliation

Canonical Level-1 owner: **C2 — First Serial Coding Loop**.

Canonical C2 requires:

`repo checkout → isolated edit → real build/test → verified artifact → serial loop end-to-end`.

This checkpoint materially exercises that shape on real GitHub-hosted Linux runner VMs, but it remains a controlled fixture and therefore does **not** prove canonical C2.

The primary spine remains:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop`.

This reference workflow is not the canonical C1 persistent Linux worker and does not bypass W1/C1 dependency or Supervisor sealing.

Client roadmap state:

- C4 Agent-origin live gate: distinct and not advanced by this checkpoint.
- C5 useful-work contract: implemented in PR #1120.
- C5 physical reference pipeline: exercised here as SYNTHETIC / CONTROLLED_FIXTURE.
- C5 LIVE Client goal: still NOT_PROVEN.

## Why this step exists

The previous C5 checkpoint proved the verifier contract but used unit fixtures only. The next unsafe boundary would be a live Client goal/provider effect.

This step closes the largest remaining safe gap first: prove that the required evidence can actually be produced by real processes and independently consumed across separate CI jobs without weakening the LIVE/SYNTHETIC membrane.

## Implementation

New scripts:

- `apps/metaengine-browser/scripts/client-c5-reference-producer.mjs`
- `apps/metaengine-browser/scripts/client-c5-reference-verifier.mjs`

Controlled repair fixture:

- `apps/metaengine-browser/test/fixtures/client-c5-reference-project/answer.mjs`
- `apps/metaengine-browser/test/fixtures/client-c5-reference-project/answer.test.mjs`
- `apps/metaengine-browser/test/fixtures/client-c5-reference-project/build.mjs`

Workflow:

`.github/workflows/client-v1-c5-reference-useful-work.yml`

## Deliberately red starting state

The checked-in fixture contains:

`answer = 41`

while the targeted test requires:

`answer === 42`.

The workflow explicitly runs the checked-in test before the producer and requires a non-zero exit.

This prevents a vacuous “repair” proof in which no behavioral change was needed.

## Source / workspace separation

The producer creates two fresh local clones at the exact workflow SHA using:

`git clone --no-hardlinks --no-tags --no-checkout`

and detached checkout of the exact source commit.

It verifies:

- source HEAD equals exact workflow head;
- workspace HEAD equals exact workflow head;
- host, source and workspace `.git` directories resolve to distinct paths;
- no `.git/objects/info/alternates` exists in source/workspace clones;
- the workspace reports exactly one Git worktree;
- the trusted source clone is made read-only before edit execution;
- the host workflow checkout is not mutated.

Upstream Git documentation says local-path clones normally use local optimizations and may hardlink object files; `--no-hardlinks` forces copies of object files instead. It also documents `--shared`/alternates as a separate object-sharing mechanism.

Source:
https://git-scm.com/docs/git-clone

Important non-claim:

This proves independent Git object directories and a private writable copy. It does **not** make Git itself a kernel/process isolation boundary. The existing A1 architecture remains authoritative on this point: a worktree or copied repository is not sufficient for ACTIVE untrusted execution authority.

## Physical useful-work chain

### Exact repo checkout

Qualified source:

`8e278110f650ac19929acba1c58eac58c3b7bcf9`

Both trusted source and private workspace were checked out detached at that exact SHA.

### Real failing pre-repair test

Observed exit:

`1`

The failure was captured into digest-bound command receipts.

### Materialized edit

Exactly one declared source file changed:

`apps/metaengine-browser/test/fixtures/client-c5-reference-project/answer.mjs`

Change:

`41 → 42`

The producer records:

- before SHA-256;
- after SHA-256;
- patch SHA-256;
- changed-file-manifest SHA-256;
- changed-file count = 1;
- materialized edit operations = 1.

The raw patch remains inside the producer artifact; the Client useful-work proof receives only the digest.

### Real passing post-repair test

Observed exit:

`0`

### Real artifact build

The repaired fixture build emits:

`reference-artifact.json`

with semantic content:

- schema `metaengine.client-v1.c5-reference-artifact.v1`;
- answer `42`;
- verified behavior `answer-is-42`.

Artifact SHA-256:

`43149bdfa6c00edd65fa56879caa69bc0c717882f14f0f3b47cb9fd11f38c867`

### Producer provenance

Producer provenance SHA-256:

`c052da1dba5489a441eb7b4ecc6d2a75a9afdd2ffa1f52044492f0e6fb840c77`

The provenance binds:

- repository identity digest;
- exact source head;
- source tree;
- source snapshot digest;
- command contract digest;
- patch digest;
- changed-file manifest digest;
- failing test receipt digest;
- passing test receipt digest;
- build receipt digest;
- final artifact digest + bytes;
- GitHub run/job identity.

## Cross-job artifact handoff

Producer evidence artifact:

- ID: `11382287012`
- name: `client-c5-reference-producer-8e278110f650ac19929acba1c58eac58c3b7bcf9`
- GitHub artifact digest: `sha256:621233a3b7268b720abb4e17f5282070685b9f9044544bf1ab8511c91948fd6f`

The verifier job downloads the producer evidence by immutable artifact ID.

GitHub documents workflow artifacts as the supported mechanism to pass build/test material between jobs. GitHub also documents that upload-artifact returns a SHA-256 digest and download-artifact recalculates/validates the downloaded artifact digest.

Sources:

- https://docs.github.com/en/actions/tutorials/store-and-share-data
- https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts

The workflow additionally requests `digest-mismatch: error`.

## Independent verifier VM

The second job runs on a distinct GitHub-hosted runner job and independently recalculates:

- command-contract digest;
- patch digest;
- changed-file manifest digest;
- pre-repair receipt digest;
- post-repair receipt digest;
- build receipt digest;
- artifact digest and byte count;
- provenance digest.

It verifies:

- pre-repair test failed;
- post-repair test passed;
- build passed;
- artifact semantic content is exact;
- artifact subject digest matches;
- provenance links the same subject;
- producer and verifier jobs are distinct.

Independent verification receipt SHA-256:

`35e7af19eb49758f12793120467f9e247e0a5397c286d1f0bcca8b1cca86751e`

Verifier evidence artifact:

- ID: `11383101083`
- name: `client-c5-reference-verification-8e278110f650ac19929acba1c58eac58c3b7bcf9`
- GitHub artifact digest: `sha256:f9f337cdeb5f71a05d42db6c2cbd9b2a823fdbba4f1392dbb2f00b3e1f5f939c`

## C5 membrane result

The verifier converts the real producer receipts into a controlled synthetic execution binding and passes it through the actual C5 useful-work normalizer.

Result:

- `user_goal_to_verified_artifact_readback=true`
- canonical C2-shaped evidence facts = true;
- `evidence_class=SYNTHETIC`;
- `evidence_origin=CONTROLLED_FIXTURE`;
- `client_c5_useful_work_verified=false`;
- `canonical_c2_promotion_authorized=false`;
- `authority_effect=false`.

This is the intended outcome.

Real execution of repo/edit/test/build/artifact does not become LIVE Client evidence merely because the mechanics are physical.

## Exact CI

Workflow:

`Client V1 C5 Reference Useful Work`

Run:

`37394759431`

Run number:

`1`

Exact head:

`8e278110f650ac19929acba1c58eac58c3b7bcf9`

Producer job:

`112047970126` — **SUCCESS**

Independent verifier job:

`112048038350` — **SUCCESS**

C5 contract rerun in verifier:

- tests: 13
- pass: 13
- fail: 0
- skipped: 0

Host/verifier checkouts remained unchanged.

## Amplifier research

### Git object independence is useful but not a sandbox

Git's documented `--no-hardlinks` behavior supports the specific goal of preventing local-clone object hardlink sharing.

It does not provide process, syscall, credential, network, or kernel isolation.

Therefore the reference producer is correctly labeled SYNTHETIC. A future ACTIVE Agent workspace still needs the A1 substrate boundary and current W1/Supervisor authority.

### Artifact digest is necessary but not sufficient

GitHub artifact digest validation protects the inter-job transport from unnoticed byte drift.

It does not by itself prove that the artifact represents the intended behavior.

Therefore the second verifier additionally:

- parses the produced artifact;
- verifies expected semantic content;
- binds it to exact patch/test/build receipts;
- verifies producer provenance.

### SLSA-style provenance strengthens the final acceptance shape

SLSA 1.2 defines provenance as verifiable information tracing an artifact to where, when and how it was produced. Build provenance is specifically intended to connect build outputs back to source/process.

Source:
https://slsa.dev/spec/v1.2/provenance

This confirms the C5 split between:

- artifact subject digest;
- production provenance;
- independent verification receipt;
- Client-level acceptance.

The reference provenance here is project-specific evidence, not a claim of a particular SLSA Build level.

## Adversarial properties proven

The workflow fails closed when:

- exact head checkout drifts;
- checked-in baseline unexpectedly passes;
- independent Git directories alias;
- Git alternates are present;
- linked worktree count is not one;
- pre-repair test does not fail;
- edit is not materialized;
- changed source is not exactly the declared fixture file;
- post-repair test fails;
- build fails;
- artifact is absent or changes digest;
- provenance material drifts;
- producer/verifier job identity is not distinct;
- C5 normalizer attempts to promote SYNTHETIC evidence;
- host checkout is modified.

## Non-claims

This checkpoint does **not** prove:

- a live z.ai Agent performed the edit;
- the installed Windows Client submitted the goal;
- live Supervisor signed the useful-work readback;
- A1 ACTIVE sandbox authority;
- persistent C1 Linux-worker admission;
- network-deny isolation;
- provider credentials isolation;
- restart continuity;
- canonical C2 completion;
- production promotion.

## Next safe step

Before live provider actuation, the next safe client step is restart/reconciliation hardening:

- persist an already accepted useful-work proof;
- restart the Client journal/projection;
- re-read the same exact proof;
- prove no `client-goal-submit` or other effect is replayed;
- invalidate the proof on lease/task/result/artifact drift;
- preserve SYNTHETIC/LIVE classification across restart.

That prepares the continuity gate without exercising a live Agent/provider mutation.

## Checkpoint

Client C5 reference useful-work mechanics: **EVIDENCE_READY / SYNTHETIC PHYSICAL REFERENCE**.

Client C5 LIVE useful work: **NOT_PROVEN**.  
Canonical C2: **NOT_PROVEN**.  
Canonical promotion authority: **false**.
