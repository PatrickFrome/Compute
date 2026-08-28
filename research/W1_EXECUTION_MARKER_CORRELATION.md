# W1 Execution Marker Correlation — Deep Research / Decision Record

Date: 2026-08-28
Status: PREP / NONCANONICAL / NOT DEPLOYED
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`

## Why this slice exists

A successful AWS Systems Manager `SendCommand` or `GetCommandInvocation(Status=Success)` proves only that AWS reports the requested SSM plugin completed. It does **not** by itself prove that the intended W1 worker payload executed, that the worker independently reported the same execution, that evidence reached the control plane, that evidence was durably persisted, or that the worker survived a provider reboot.

The next safe step is therefore a correlation contract that binds three independently observed surfaces without promoting any of them to W1 authority:

1. the already-reviewed strict package-provisioning provenance;
2. the exact SSM execution invocation and one canonical stdout marker;
3. a separately authenticated callback attesting receipt of the exact same marker body.

Only after this correlation is durably inserted and independently read back may it become an execution-evidence candidate. Persistence across reboot remains a separate later proof.

## Research findings

### 1. AWS Run Command has no standalone `InvocationId` in `GetCommandInvocation`

AWS documents `GetCommandInvocation` around the tuple `CommandId`, `InstanceId` (or managed-node ID), and `PluginName`. The response includes these fields, status, execution timestamps, response code, and output, but not a separate provider-issued `InvocationId`.

**Decision:** never invent or overload an `InvocationId`. The controller computes:

`invocation_key_sha256 = sha256(canonical({command_id, instance_id, plugin_name}))`

This preserves exact AWS semantics and makes aliasing explicit.

Official source:
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetCommandInvocation.html

### 2. Run Command observation is eventually consistent

AWS explicitly warns that Run Command follows eventual consistency. A just-issued command can therefore temporarily be absent or stale when queried.

**Decision:** eventual-consistency retry belongs only in the transport/observation workflow. The correlation guard itself consumes already-captured JSON and remains deterministic. Retry must stay bounded and must not turn authorization, region, instance, or document mismatches into retryable states.

Official source:
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetCommandInvocation.html

### 3. Stdout is a bounded evidence channel, not a log transport

AWS documents `StandardOutputContent` as returning only the first 24,000 characters of command output.

**Decision:** W1 emits exactly one line with prefix:

`METAENGINE_W1_EXECUTION_MARKER_JSON=`

The marker is capped to 4096 UTF-8 bytes, no additional stdout is permitted, stderr must be empty, and S3/CloudWatch output URLs are rejected. This keeps the proof well below the AWS truncation boundary and prevents hidden side-channel output from being silently treated as evidence.

Official source:
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetCommandInvocation.html

### 4. `SendCommand` has a much larger mutation/output surface than the minimal W1 need

AWS `SendCommand` supports Targets, parameters, S3 output, CloudWatch output, notifications, alarms, service roles, comments, concurrency/error controls, and other fields.

**Decision:** the existing strict provisioning semantics remain a prerequisite. Execution-marker work does not relax that contract; a future execution document must likewise be exact-version/hash/target bound and parameter-minimal.

Official source:
- https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_SendCommand.html

### 5. Callback ingress cannot equate reachability with authenticity

A worker callback reaching an HTTP endpoint proves transport only. It cannot be treated as an authenticated worker statement merely because the endpoint is obscure or because it carries a worker ID.

Two acceptable future authentication classes are kept in the contract:

- `WORKER_ENROLLMENT_SIGNATURE_V1` — callback signed by an enrollment-bound worker key whose verification is independent of the worker-supplied identity string;
- `SIGNED_PROVIDER_IDENTITY` — provider identity attestation verified against the provider trust root and cross-bound to the expected instance.

AWS recommends cryptographic verification of EC2 Instance Identity documents when the identity is important. Region-specific AWS public certificates are published for this purpose.

Official sources:
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/verify-signature.html
- https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/regions-certs.html

### 6. Supabase Edge Function should be a small verification/RPC ingress, not the proof authority

Current Supabase guidance supports authenticated functions and webhook-style endpoints that perform their own signature verification. Secret/service-role credentials must stay server-side because they bypass RLS. Edge Functions also have bounded memory/CPU/wall-clock resources.

**Decision:** do not deploy an Edge callback in this slice. Before deployment, implement one concrete cryptographic callback scheme, replay protection, body-size limits, timestamp/nonce expiry, and exact RPC-only database access. The worker must never receive a Supabase service-role/secret key.

Official sources:
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/functions/examples/stripe-webhooks

## Comparison / amplifier matrix

| Evidence surface | What it can prove | What it cannot prove |
| --- | --- | --- |
| `SendCommand` accepted | AWS accepted a command request | payload executed; callback; persistence; W1 |
| `GetCommandInvocation=Success` | exact plugin invocation completed according to SSM | intended marker reached control plane; persistence; reboot survival |
| SSM success + canonical marker | exact marker was present in bounded invocation stdout | callback authenticity; DB persistence; reboot survival |
| SSM marker + verified callback | two observation planes agree on exact marker body | durable DB persistence; worker persistence; W1 |
| + append-only DB insert + readback | correlated execution evidence survived a DB write/readback boundary | reboot survival; worker admission; W1 |
| + pre/post heartbeat witness + provider reboot receipt | same machine/witness survives independently observed reboot | canonical W1 verification until supervisor acceptance rules pass |

## Implemented contract

`controller/w1/w1_execution_marker_guard.py`:

- validates existing strict provisioning provenance first;
- validates exact execution document/version/plugin/status/response code;
- rejects stderr, output URLs, CloudWatch output, multiline or oversized stdout;
- validates exact marker worker/instance/package/payload digests and timestamps;
- derives `invocation_key_sha256` from the actual AWS identity tuple;
- requires an independently verified callback with exact marker-body SHA;
- cross-binds callback and invocation timing;
- emits `W1_EXECUTION_MARKER_CORRELATED_CANDIDATE_UNINGESTED` only.

`supabase/prep/w1_execution_marker_receipt_v1.sql` is intentionally **PREP ONLY**:

- append-only receipt table;
- RLS enabled;
- service-role-only select/insert and function execute;
- `SECURITY INVOKER` only;
- deterministic evidence hash and idempotency conflict detection;
- separate database-write and persisted-readback claims;
- no enrollment update, admission, roadmap mutation, checkpoint seal, or W1 promotion.

## Nonclaims / gates

This slice does **not**:

- execute AWS `SendCommand`;
- create/update an SSM document;
- deploy a callback Edge Function;
- apply the prepared SQL to live Supabase;
- insert any execution receipt;
- reboot a host;
- admit a worker;
- produce persistent-worker proof;
- mark W1 `EVIDENCE_READY` or `VERIFIED`;
- mutate canonical roadmap/checkpoint authority.

## Required next sequence

1. Run the already-prepared **read-only W1 readiness dispatch** through its explicit protected gate.
2. Only after readiness PASS, prepare the exact execution-marker SSM document and one concrete cryptographically authenticated callback ingress.
3. Re-run research + adversarial tests for that concrete auth mechanism.
4. Execute one real marker cycle under the protected live gate.
5. Persist the exact correlation receipt through the reviewed RPC and perform independent persisted readback.
6. Obtain pre/post heartbeat persistence witness plus independently correlated provider reboot receipt.
7. Only then evaluate W1 for `EVIDENCE_READY`; supervisor acceptance still remains separate from evidence production.
