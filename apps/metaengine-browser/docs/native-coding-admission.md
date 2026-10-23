# Native coding admission contract

Status: source components, awaiting native main composition and installed proof.
No model calls, provider enrollment, live migrations or service changes are
performed by these modules or their unit tests.

## Separate local QA scope

`LOCAL_OPERATOR_QA` is an explicit local operator scope. It does not satisfy or
replace W74 release custody, Authenticode, release-root signatures or SLSA.
Every proof retains `production_qualified:false`, `authority_effect:false` and
`automatic_retry_allowed:false`. Neither an unsigned package nor a generated
test identity is reclassified as production evidence.

`native-coding-transport-proof.mjs` verifies purpose-bound ES256 signatures
(SHA-256, P-256, IEEE-P1363) under the existing enrolled Supervisor device key.
Its fingerprint is the existing `SupervisorDeviceIdentity` canonical public JWK
fingerprint. The verifier receives a pinned native key and an independent
`expected` scope; a payload cannot select its own issuer key or expected scope.

Provider schema: `metaengine.codex-cli.transport-proof.v1`.
Job schema: `metaengine.codex-cli.job-proof.v1`.
Target: `codex-cli:<provider UUID>`; never a forged `webcontents:N` target.
The envelope is `{algorithm:'ES256',issuer_key_fingerprint_sha256,payload,signature}`.
`nativeCodingProofSigningBytes(payload)` supplies the domain-separated canonical
bytes. Signatures cannot be reused as HTTP, Guardian or production-custody proofs.

## Private host producer

`createNativeCodingHostIssuer(...)` requires the existing loaded, enrolled
`SupervisorDeviceIdentity`. Its new purpose-limited `signNativeCodingProof`
method has no renderer, HTTP or delegated signer route. It neither calls
`ensure()` nor creates, exports, rotates or enrolls a key.

The factory exposes:

```js
await issuer.issueProvider({provider_id,agent_id});
await issuer.issueJob({provider_id,agent_id,task_id,lease_generation,run_id,prompt_sha256});
issuer.close();
```

Request fields identify records to read. Authority-bearing values come from
private closures installed by native main, not from model/renderer JSON:

| Closure | Required observation source | Value |
| --- | --- | --- |
| `readPermit` | `PROTECTED_OPERATOR_PERMIT_READBACK` | Protected explicit QA scope, storage evidence and record digest |
| `readInstalledImage` | `INSTALLED_IMAGE_NATIVE_VERIFIER` | Exact installed EXE, ASAR, runtime bundle, source and CLI hashes |
| `readNativeHost` | `OS_PROCESS_INVENTORY` | Host PID, kernel birth and user SID |
| `readPostgres` | `ATTACHED_OWN_POSTGRES_READBACK` | Attached cluster system identifier, postmaster birth, data directory identity, workspace/project |
| `readWorktree` | `NATIVE_FILESYSTEM_AND_GIT_READBACK` | Managed canonical local path, root identity and base HEAD |
| `readSandbox` | `OS_SANDBOX_CANARY_READBACK` | Actual bounded OS sandbox result for the selected role |
| `readLiveLease` | `W30_OWN_PG_LIVE_LEASE` | Already-issued live task/claim, exact generation/agent/target/role/base/prompt and Critic subject |
| `readNativeWorker` | `OS_PROCESS_INVENTORY` | Actual suspended worker, run, private Job handle ID and launched prompt hash |
| `readCriticSubject` | `PROTECTED_NATIVE_CODING_RECEIPT` | Independent author's result and exact reviewed Git artifact |

Every closure returns
`{schema:'metaengine.native-coding.host-observation.v1',source,observed_at,value}`.
This shape is a composition contract, not an attestation in itself. Supplying a
fixture closure does not demonstrate OS, PostgreSQL, ACL or installed execution.
Readers must independently obtain and validate their evidence. They cannot
forward the runner's process JSON or an agent's assertion as native readback.
All observations must still be within 30 seconds at the end of a collection.

The permit is `metaengine.native-coding.operator-permit.v1` and must pin the
goal digest, Owner epoch, Windows SID, enrolled device, exact package/CLI image,
own PostgreSQL identity, workspace/project, provider, logical agent/role/epoch,
managed worktree and physical slot budget. It includes `issued_at`, `expires_at`,
`revoked`, `storage_evidence_sha256` and `record_sha256`. This factory does not
create an operator permit or infer approval from a model-controlled flag.

After signing, the factory re-reads the full scope and returns no proof on any
change or revocation. The signature is verified again against the first pinned
identity and expected bindings before publication. A provider proof expires in
at most 60 seconds. A launch proof expires within 20 minutes, its permit and the
existing W30 lease; it grants no retry after expiry.

Process identity is `{pid,created_at,process_incarnation_id}` where `created_at`
is canonical UTC ISO with milliseconds and the incarnation is
`pid:N:created_100ns:FILETIME`. Kernel FILETIME must actually be read; converting
a rounded WMI timestamp and claiming exact kernel birth is invalid. The whole
identity is compared with private native readback, including protection against
PID reuse.

The sandbox value is
`{backend,mode,evidence_sha256,outside_write_denied,worktree_write_denied}`.
Backends accepted by this contract are `WINDOWS_RESTRICTED_TOKEN`,
`WINDOWS_APPCONTAINER` and `CODEX_WINDOWS_ELEVATED`; accepting an enum does not
prove its deployment. Writer mode is `workspace-write`; Critic mode is
`read-only`. The host must verify evidence bytes, exact CLI/worktree/role and
actual canary results. Job Objects provide lifetime control and cannot stand in
for the OS filesystem boundary. Filesystem canaries do not prove network denial.

Critic proof binds `{run_id,result_sha256,git_artifact_sha256,source_head,
agent_id,worker_process}` to the protected author receipt and the live lease's
`verification_subject`. Distinct logical agent, run and native process
incarnation are required. The runner separately must prove its starting Git
artifact equals that reviewed subject and remained unchanged during review.
The model's result JSON hash alone does not bind the reviewed patch.

The physical slot budget is finite (1–64), independent of logical agent count.
Many logical agents can share bounded physical lanes through W30. This does not
claim infinite simultaneous processes or prove unlimited execution duration.

## Existing W30 integration points

Keep one scheduler and the existing lease RPC. Source integration requires all
of these gates; the proof/issuer modules alone do not enable installed coding:

1. Native `main.mjs` composes the issuer and a private suspended-worker registry,
   using the existing enrolled identity, protected operator permit and attached
   own-PG readers. No issuer or generic signer is exposed to renderer IPC.
2. `devos-routes.mjs` currently filters targets to `webcontents:N` in `binding`
   and `boundedAgents` (lines 105 and 127–136 at the source base). Add a typed
   native descriptor branch while preserving the browser branch. It must retain
   role fairness, bounded active physical slots and exact provider epochs.
3. `POST /v1/devos/cycle` still calls the existing
   `public.devos_fleet_lease_v1` (currently route line 356). Do not add a second
   lease poller. The latest lease implementation is in
   `20260929010000_client_v1_fresh_project_bootstrap_v1.sql:193`.
4. The claim trigger is last defined in
   `20260903052200_devos_dispatch_admission_signed_native_v3.sql:13`. It currently
   requires browser fleet/transport schemas and conversation proof. An additive
   native branch must independently verify the signed native heartbeat's enrolled
   device and a fresh, host-bound QA provider descriptor under a server-pinned
   key/permit scope. A target-regex change alone is unsafe. Browser ambiguity
   fences must remain intact; a CLI provider cannot settle an old chat send.
5. `normalizeLease`, `assertLiveLeaseBinding` and `#dispatchLease` in
   `devos-native-task-cycle-core.mjs` currently enforce browser targets. A typed
   CLI branch calls `createNativeCodingLeaseExecutor` for an already-issued W30
   lease. A suspended worker may resume only after independent job issuance and
   the own-PG `ATTEMPTED` barrier commit. Restarts read the durable ledger instead
   of spawning again for the same task/generation.
6. Capacity/pressure SQL still filters browser targets, including the latest
   substrate projection in
   `20260929133000_client_v1_fresh_meta_orchestrator_substrate_v1.sql:808`.
   Native provider accounting needs a typed additive projection, not a fake tab.
7. Result/independent Critic/own-PG checkpoint completion and physical restart
   continuation must be demonstrated from the installed client. Neither the
   execution ledger nor a signed model result grants completion or release
   authority.

The protected issuer, SQL admission branch and actual installed main caller
must be qualified together before advertising executable backend readiness.
Existing production W74/SLSA/Authenticode checks remain unchanged.
