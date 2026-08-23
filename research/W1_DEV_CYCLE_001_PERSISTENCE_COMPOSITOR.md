# W1 DEV-CYCLE-001 — persisted-readback admission compositor

Status: IMPLEMENTED / NON-AUTHORITY / LIVE EVIDENCE NOT YET AVAILABLE

Canonical Level-1 milestone: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Same-World precondition

Immediately before this semantic step the canonical database still reported:

- semantic head `metaengine-h205f22-recovery-dev-20260821-cp072`;
- roadmap definition integrity `true`;
- active Supervisor directive `#22 CONTINUE`, base CP072;
- W1 claim `#19` ACTIVE and effective-live, expiry `2026-08-23T10:04:55.316946Z`;
- GitHub `main=d674e4a1843367efec0690672ba232cc425cf13b`;
- W1 branch head `3d976be7ce16de0d830194c6727e4c67badd9066`.

No F1 mutation is part of this change.

## Live database reality

At the implementation boundary the W1 evidence tables reported:

- provider reboot receipts: `0`;
- Linux backend bindings: `0`;
- dedicated Linux safety verifications: `0`;
- Linux safety observations: `18`.

The currently enrolled `glm-sandbox-worker-01` has a verified host probe, but the canonical safety-status function returns `LINUX_SAFETY_OBSERVATION_REQUIRED`. Therefore no live admission candidate exists and this step MUST NOT create synthetic provider/binding/safety rows merely to satisfy the compositor.

## Problem

The preceding host-safety contract correctly removed all host-self-asserted persistence/reboot/identity fields. The next boundary must combine independent evidence without reintroducing those claims through a generic JSON object.

A particularly important semantic trap exists in the current AWS provider controller: EC2 `RebootInstances` is asynchronous. The CloudTrail event and API response establish that the provider accepted/observed a reboot request; they do not establish that the reboot completed. The existing controller already records the explicit semantics:

`PROVIDER_REQUEST_ACCEPTED_AT_NOT_REBOOT_COMPLETION`

The compositor preserves that law and rejects any receipt that upgrades the field to `REBOOT_COMPLETED`.

## Research before implementation

Current AWS EC2 documentation was rechecked for `RebootInstances`: the operation queues an asynchronous reboot request. A successful API response is not reboot-completion evidence.

Current AWS EC2 instance-identity documentation was also rechecked. The Instance Identity Document has AWS-verifiable signature forms and exposes provider-bound instance identity. This is a stronger identity source than an unverified host/provider metadata string.

Current Linux kernel documentation was rechecked for `/proc/sys/kernel/random/boot_id`: it is a UUID for the running kernel instance and remains stable during that boot. Therefore a changed, independently persisted pre/post `boot_id` is useful reboot evidence when correlated to the same provider identity; it is not sufficient on its own to prove provider identity.

## Adopted evidence boundary

`worker/native_linux/admission_candidate.py` accepts only exact persisted-readback objects whose `source` is:

`SUPABASE_PERSISTED_READBACK`

Required independent planes:

1. **Dedicated safety verification**
   - status `VERIFIED`;
   - unexpired at evaluation time;
   - binds the post-reboot probe SHA;
   - noncanonical and non-authority.

2. **Backend binding**
   - same enrollment/worker;
   - `NATIVE_LINUX` or `SELF_HOSTED_VM`;
   - persistence `NATIVE_PERSISTENT` or `PERSISTENT_SNAPSHOT`;
   - execution state `LIVE_SESSION_OBSERVED` or `PROBED`;
   - exact provider-kind/provider-instance binding;
   - noncanonical and non-authority.

3. **Provider reboot receipt**
   - accepted persisted receipt;
   - exact same worker/provider instance;
   - action `REBOOT`;
   - retains request-not-completion semantics;
   - requires `SIGNED_PROVIDER_IDENTITY` with `identity_attestation_verified=true`;
   - noncanonical and non-authority.

4. **Pre/post worker probes**
   - persisted PASS probe-v2 receipts;
   - exact payload SHA recomputation;
   - same enrollment/worker;
   - strict time ordering around the provider request;
   - architecture stable;
   - `boot_id` must change.

## Output boundary

Even if all conditions pass, the only possible result is:

`ADMISSION_CANDIDATE_NON_AUTHORITY`

and the following remain hard false:

- `worker_admitted=false`;
- `persistent_worker_proof=false`;
- `w1_verified=false`;
- `canonical=false`;
- `authority_effect=false`.

Supervisor verification remains mandatory.

## Adversarial tests

The dedicated suite rejects:

- self-reported/non-persisted evidence source;
- missing or expired safety verification;
- EPHEMERAL backend;
- unobserved backend;
- provider-instance aliasing;
- cross-worker composition;
- unchanged boot ID;
- invalid reboot/probe chronology;
- safety verification bound to the wrong probe;
- reinterpretation of request time as reboot completion;
- unaccepted reboot receipt;
- unsigned/unverified provider identity;
- probe payload/hash tampering;
- authority escalation;
- unknown fields.

## Research-after / next exact slice

The new compositor deliberately creates a new blocker rather than weakening the boundary: the current AWS provider controller emits `PROVIDER_METADATA` with `identity_attestation_verified=false`, so it cannot satisfy admission composition.

The next W1 semantic slice should implement and adversarially verify an AWS-signed Instance Identity Document binding to the exact EC2 instance/provider receipt, then obtain real persisted pre/post reboot probes and a dedicated post-reboot safety verification. Only those live bytes may exercise the compositor toward a Supervisor-reviewed C1 admission event.

No canonical checkpoint, worker admission, W1 verification or roadmap promotion is performed by this step.
