# Guardian pipe qualification — 2026-10-01

Qualified source: `4f66a5afc7d6dd6ab36262effac6ac199c9b68e1`
Branch: `work/guardian-pipe-observation-v1` · PR [#1088](https://github.com/PatrickFrome/Compute/pull/1088)
Base: qualified Guardian bootstrap `5b585ae301cdc273f58d01963e54b5b6f539181d` (PR #1087).

The evidence commit is separate from the tested source. No release-relevant changes follow the qualification.

## Outcome

All 10 triggered exact-head workflows are terminal SUCCESS. Full Browser Node suite: **3851/3851 PASS**, zero failures/skips.

| Workflow | Run | Result |
|---|---:|---|
| METAENGINE Browser Shell V1 | 36909837082 | SUCCESS |
| Browser Workspace Reincarnation V1 | 36909837121 | SUCCESS |
| METAENGINE Browser Host Resilience Login Start V1 | 36909837055 | SUCCESS |
| METAENGINE Browser Critical Audit V1 | 36909837050 | SUCCESS |
| METAENGINE Browser Shell-First Dirty Profile V1 | 36909837065 | SUCCESS |
| Browser Windows Installed Chat Qualification | 36909837047 | SUCCESS |
| METAENGINE Browser Final Runtime Activation V1 | 36909837049 | SUCCESS |
| METAENGINE Browser Windows Autonomous Soak V1 | 36909837077 | SUCCESS |
| Browser Windows Package Smoke | 36909837046 | SUCCESS |
| METAENGINE Browser Self Update E2E | 36909837083 | SUCCESS |

## Runtime fixes

- Activation is offered only for a structured OS ENOENT before the pipe connects. Timeout, disconnect, access denial and message-only ENOENT HOLD with no UAC or enrollment.
- Invalid native receipt schema/authority/state is caught inside the data callback and rejects the request.
- Close without a receipt and slow partial data cannot keep a request pending indefinitely. Absolute deadline and byte bound remain mandatory.
- Late connect/data after settlement cannot write or resolve.
- Owner requests own fixed deadlines: 2s read-only → 30s single ticket-bound enrollment → 2s independent readback. Native HTTPS phases allow 3–5s each, so enrollment must not inherit the 2s observation budget. Caller timeout widening is ignored.
- New client recovers lost acknowledgement from saved owner proof without a second ticket; another device fingerprint fails closed.

No new scheduler, executor, model API or renderer authority was introduced.

## One built artifact

[Download candidate ZIP](https://github.com/PatrickFrome/Compute/actions/runs/36909837046/artifacts/11185889900)

Installer: `METAENGINE-Browser-Test-Setup-0.7.0-dev.36908273822.1-x64.exe`
Version: `0.7.0-dev.36908273822.1`
Size: **159808744 bytes**
SHA-256: `dc77ca4cabb4406aed761385ca42adde1fd6490e530653814dd9a577291a284a`

Producer: Package Smoke 36909837046, number 3110, attempt 1.
Artifact 11185889900: 161263079 bytes; ZIP SHA-256 `5d0acc9ea91a02eaf74dd647c1d2cfe325fd797584ea5c9f9a1abfb0fd8d1bd8`.

[Package evidence](https://github.com/PatrickFrome/Compute/actions/runs/36909837046/artifacts/11187170606): 469463 bytes; ZIP SHA-256 `2ef8fb565be461fcf76260ace3bf868302e147c3a4664a6bcc55cb6656f86462`.

Companion: `METAENGINE-Guardian-Bootstrap-0.7.0-dev.36908273822.1-x64.exe`, 1283584 bytes; SHA-256 `b0aa78ab22d536be07fa43a7ac660bb0fed66b06b76c4b539df8f48d969f4142`.

Unsigned, unpublished development candidate; promotion_authorized=false.

## Physical Windows evidence

Package Smoke asserts exact machine copy, independent SCM Running and protected ACL readback, tamper/policy/stopped-service HOLD, normal UI boot, second-instance activation and 190s survival on the same primary PID. Physical bootstrap test executes no owner enrollment or emergency installer dispatch.

Installed Chat confirms nonce-bound OIDC → ADMIN_CONNECTED on the exact candidate and installer digest.

Self Update consumes the same installer/blockmap/config. Published baseline 0.7.0-dev.36806234662.1 → candidate PASS. Resident baseline 0.7.0-dev.34759310781.1: old Browser/Sentinel gone; new Browser/Sentinel started; installer exit 0; planned shutdown proven; retry dialog=false. Exact producer terminal success is verified.

These are CI Windows proofs, not user-machine owner/enrollment or useful z.ai task execution.

## Live user boundary and roadmap

At 18:58:56 UTC, installed user client remained on **0.7.0-dev.36832190273.1** with a fresh heartbeat. ADMIN epoch1, Compute HEALTHY and Development Plane READY were read back. Supervisor PARKED, admission CLOSED, generation floor28, reset reason SIGNED_PROFILE_BOOTSTRAP_CLOSED. Guardian ticket count for this user was zero; native owner binding is not qualified.

DB authority still names METAENGINE_CLIENT_V1 / C4_TYPED_PRODUCT_CONTROL, baseline `1fde1e53549eafefd6c28b50cdcd384e86d14512`, alignment epoch3. This branch does not rewrite canonical DB/release authority.

No live UAC, ticket issuance, owner mutation, emergency update or admission override was issued.

Next:
1. Explicit Settings → Runtime → Machine Guardian activation; approved ticket → native durable owner CAS → independent read-only device/owner proof → restart continuity. After AMBIGUOUS, observation only.
2. One bounded user goal → lease → authenticated z.ai Agent-origin submission → positive readback → durable result → independent acceptance.
3. Recovery/rollover and useful-work proof before continuous admission through the existing typed authority.

## Research and execution

[Node IPC, connect and timeout behavior](https://nodejs.org/api/net.html) and [structured error codes](https://nodejs.org/api/errors.html). Design inference: message text or missing response cannot prove pipe absence; inactivity timeout is not an absolute request deadline.

Workspace exec-server was unavailable. Editing/checkpointing used GitHub; execution used existing exact-head CI, with no substitute local/Windows qualification claim.
