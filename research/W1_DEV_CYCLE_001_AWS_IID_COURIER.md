# W1 DEV-CYCLE-001 — AWS IID untrusted courier boundary

Status: IMPLEMENTED / NON-AUTHORITY / LIVE HOST CAPTURE NOT YET EXECUTED

Canonical Level-1 milestone: **C1 — First Real Linux Worker**  
Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Same-World precondition

Before this step, CP072 remained canonical, roadmap definition integrity was true, Supervisor directive #22 remained `CONTINUE`, claim #19 was active with no drift, and PR #41 exact head `7d86e821167b4826405f71be3e2932737f946dd8` had green exact-head Governance, Linux Admission Contract, and AWS Signed Instance Identity checks.

Live Supabase reality remained intentionally incomplete:

- reboot receipts: `0`;
- backend bindings: `0`;
- dedicated safety verifications: `0`;
- safety observations: `18`.

No synthetic row is created by this step.

## Research recheck — AWS IMDSv2

Current AWS EC2 documentation was rechecked on 2026-08-23.

AWS documents retrieval of the IID `document` and `rsa2048` dynamic-data objects through IMDSv2 using a token obtained by HTTP `PUT` to the link-local metadata service. AWS also documents that instances can require IMDSv2 (`HttpTokens=required`) and that the metadata token response hop limit can be constrained.

The existing W1 provider preflight already requires:

- metadata endpoint enabled;
- `HttpTokens=required`;
- hop limit `1`.

## Adopted trust split

A crucial distinction is preserved:

**Transport origin is not identity authority.**

The host can retrieve and courier signed bytes, but cannot mark them verified. The independent off-host verifier remains the only component that may produce `SIGNED_PROVIDER_IDENTITY_VERIFIED_NONAUTHORITY` after cryptographic verification against the repository-pinned AWS certificate.

This permits the delivery channel itself to be treated as untrusted while preserving the cryptographic provider-identity boundary.

## Host courier

`worker/native_linux/aws_iid_courier.py`:

- connects only to fixed IPv4 link-local `169.254.169.254:80`;
- has no caller-configurable URL/host/port;
- requires a fresh IMDSv2 token and has no IMDSv1 fallback;
- uses token TTL 60 seconds;
- retrieves only the IID `document` and `rsa2048` paths;
- rejects every non-200 response, including redirects;
- caps token/document/signature sizes;
- emits raw bytes as base64 plus transport SHA-256s;
- does not parse or trust any identity field;
- emits explicit `HOST_UNTRUSTED_TRANSPORT` source classification.

All authority-sensitive claims are hard false:

- `provider_identity_verified`;
- `reboot_completion_proven`;
- `persistent_worker_proof`;
- `w1_verified`;
- `canonical`;
- `authority_effect`.

## Off-host courier verifier

`controller/w1/aws_iid_courier_verifier.py`:

- requires the exact courier envelope shape;
- requires the envelope to remain classified as untrusted;
- rejects any host-side claim escalation;
- base64-decodes with validation and size caps;
- recomputes both transport digests;
- sends only decoded bytes, the independent AWS certificate, and independent expected instance/account/Region into the existing pinned cryptographic verifier;
- attaches courier provenance only after successful core verification;
- recomputes the verification receipt digest.

The courier never bypasses the pinned `-nointern` PKCS#7 verifier.

## Adversarial tests

Tests cover:

- exact fixed link-local destination;
- token PUT followed by token-authenticated IID GETs;
- no IMDSv1 fallback on token failure;
- redirect rejection;
- payload size caps;
- transport digest recomputation;
- host claim-escalation rejection;
- byte-for-byte handoff to the cryptographic verifier.

## DB trust-gap discovered during this step

Before executing live evidence, the existing Supabase reboot ingest function was audited. It is append-only and callable only by `service_role`, but it accepts the pair:

`SIGNED_PROVIDER_IDENTITY` + `identity_attestation_verified=true`

without independently checking that the JSON evidence contains the exact pinned-verifier receipt/binding.

Because only `service_role` can execute this function, this is not a public-RPC vulnerability. It is nevertheless too weak for the intended W1 evidence law: a compromised or buggy privileged caller could persist a syntactically verified identity without the cryptographic proof object.

Therefore the next DB semantic slice must harden the privileged ingest path so a signed-identity receipt is accepted only when its persisted evidence includes and binds the expected verifier schema, exact provider/account/Region/instance values, certificate/document/signature digests, verification receipt digest, non-authority flags, and request-not-completion semantics. The legacy permissive path must not remain usable for `identity_attestation_verified=true`.

No real provider reboot should be ingested before that guard exists.
