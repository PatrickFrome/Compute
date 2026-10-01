# Guardian owner recovery checkpoint — 2026-10-01

Qualified installer/source remains `5b585ae301cdc273f58d01963e54b5b6f539181d` (PR #1087). This checkpoint changes tests only.

Added fault scenarios:
- Native durable owner CAS succeeds but acknowledgement is lost. First client reports AMBIGUOUS. A new client with a fresh command/nonce recovers using read-only saved owner proof; total ticket issuance stays one.
- Persisted owner reports another device fingerprint. New client rejects before requesting any enrollment ticket; no owner replacement occurs.

Validation: enrollment actuator, bootstrap launcher and ticket client suites: 23/23 PASS, zero skips. Local TMPDIR is an explicit writable workspace directory; initial default /tmp attempt failed because the directory was unavailable, then all suites passed with workspace TMPDIR.

Scope: simulated native transport and identity contract, not physical Windows enrollment/restart or live user device proof. No runtime source, version, deployed Edge, SQL or installer bytes changed. No live effect/ticket/owner mutation issued.

Next gate: approved installed device → real ticket → native owner CAS → independent read-only proof → service/client restart readback. Reuse installed qualification authority and existing native pipe; never substitute DB edits or blind update retries.
