# Guardian production bootstrap checkpoint — 2026-10-01

Continuation of PR #1087 from `c1e93e7c0f49ba91d38b66cb8774fe316b6842bb`, based on release `719febc00bd8879715a0633e8fe9d85acacead41`.

## Confirmed defects and changes

- Guardian service installation was only a pure plan/CI configurator. The successor adds a dedicated one-shot machine installer with `requireAdministrator`, exact service/configurator/manifest PE resources, build-time SHA-256 bindings, fixed Program Files slot and protected ProgramData owner-store root. It never reads a caller asset path, URL or shell string. It reuses the existing production SCM configurator and reads back exact LocalSystem/own-process/auto-start/Running state.
- Exclusive flushed machine intent fences partial copy/config/start. Existing service drift, stopped service and nonterminal prior attempts hold. A successfully repeated invocation observes exact terminal bytes/status without restarting, reconfiguring or replacing an owner.
- Bootstrap is a separate elevated component inside the per-user Browser package and in the immutable producer artifact. The ordinary Browser installation/update scope and app/profile identity are unchanged. The Browser does not silently elevate or dispatch the component.
- First owner enrollment really writes the native owner store; its receipt has `effect_absent_proven=false`. The JS client incorrectly required true. Completion now uses an independent read-only signed owner challenge after the single ticket-bound CAS. Readback loss remains AMBIGUOUS and blocks installer dispatch.
- Enrollment HTTPS now has an eight-second overall deadline (including streaming body), no redirects, 16 KiB response cap and no retry. Native redemption classifies malformed/upstream error replies as unknown, rather than asserting a rejected ticket.
- SQL issue/consume hold the exact device row FOR SHARE through commit. ADMIN scope checks fail closed on NULL, expiry is rechecked at the consume update, and ticket-table RLS is enabled with no public grants.
- SCM Host workflow now verifies the current bounded process adapter plus write-ahead/device/ticket fences, instead of requiring the retired pre-actuator field/absence of child dispatch.
- Native service/configurator and companion use static CRT (`/MT`) so a clean Windows installation does not depend on a developer's VC runtime.
- Repeated bootstrap observation now revalidates current SCM required privileges, service SID, failure flag and exact restart schedule, plus all ancestor ACLs/reparse fences held during readback. Terminal markers alone cannot hide policy or directory trust drift. Physical negative cases change the fixture policy/root ACL and require HOLD without repair or restart.
- Both fixed-resource allowlists include the new separate companion. The first complete Node run found 3817 PASS / one stale allowlist expectation; Shell and Self Update reported that same assertion. The successor preserves an exact allowlist and reserves a higher package identity after the first NSIS bytes were built.

## Verification at source checkpoint

Focused Node: 54 PASS, one existing Windows-only PowerShell parser case skipped locally. Installer provenance/upgrade/bootstrap: 35 PASS. Windows compile and physical qualification remain mandatory; local source checks are not native runtime proof.

Meta project: `jhriwwsryeqsvvvufkok`. Migration `browser_guardian_enrollment_ticket_v1` applied atomically with 14 SQL cases and fixture rollback. Body readback MD5 (source equivalence, not cryptographic authorization): issue `78d859006e01878d595a4a70692826fc`, consume `eef6d980a8bbd69a62edf147a20d6779`.

Installed user heartbeat at 04:09 UTC still reports `0.7.0-dev.36760350225.1`; this does not prove that the successor or Guardian companion is installed on the user's machine. No new live emergency update command or ambiguous-effect replay was issued.

Package Smoke `36815152180` physically compiled the first companion and installed the NSIS candidate. Normal UI, second instance and the 190-second startup-grace proof passed. The first native bootstrap returned `EXACT_MACHINE_COPY_SCM_AND_RUNNING_PROVEN`, but the PowerShell first-install assertion failed before independent readback. The successor retains the process handle, completes redirected streams after bounded termination, rejects unavailable exit status explicitly and uploads each native stdout/stderr receipt. The first artifact is not a qualified machine-bootstrap release.

Canary v26 is deployed at immutable source pin `5aaae3e6696eeee07c09a65ff467857aab67732b`, digest `878bb81e59109e93aa49492655c6d856668495c9e85d21c323978b59d9b46eb1`. A separate ticket-only, bounded stable-to-canary redemption adapter is necessary because LocalSystem carries no Browser identity header. It forwards only the exact redemption route, validates three bounded ticket fields and never manufactures device identity, retries or falls back. Its stable deployment requires separate readback.

Stable v10 digest `e6a365996221a6ed0edddbe261e450d7e17cafca1cdfb12e3bc8cff715af61cc` has the immutable redemption adapter pinned to `ec20a79e45a686aa840853b7ee404b6816730bd0`. Both stable and canary deployed bodies were read back byte-equivalent. Live Probe run `36815151981` exercised fresh random unissued tickets: both returned exact `409 / TICKET_NOT_AVAILABLE / accepted=false / authority_effect=false`; the stable forwarding header was verified. This proves route availability/rejection, not successful owner enrollment or production promotion. Final SQL readback still has zero ticket/fixture rows and RLS enabled.

## Required exit gates

One Package Smoke producer must build and package the companion, verify its exact source/hash binding, physically prove copy/ACL/SCM/Running, repeated observation only, embedded tamper rejection and stopped-service HOLD. Downstream Installed Chat, Final Runtime, Soak and Self Update consume the same Browser installer and require producer terminal success.

Edge source changes require a new immutable canary pin/deployment and source-equivalence readback. The ticket SQL migration alone does not make the new routes deployed. Stable promotion, owner enrollment on the user's machine, emergency installer handoff and genuine z.ai Agent useful-work remain separate live gates.

## Research basis

- Microsoft service security: only privileged identities receive service creation/configuration access; `SERVICE_CHANGE_CONFIG` must not be granted to ordinary users. https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights
- Microsoft application manifests: embed explicit `requestedExecutionLevel` in the executable; elevation belongs to the installer boundary. https://learn.microsoft.com/en-us/windows/win32/sbscs/application-manifests
- Microsoft PE resources: immutable packaged resource bytes can be loaded without accepting external filesystem inputs. https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-loadresource
- Microsoft process wait: complete redirected output processing after a successful finite `WaitForExit(Int32)` before interpreting the child result. https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.waitforexit
- Supabase API security: combine restricted EXECUTE/table grants with RLS and explicit privileged function authorization. https://supabase.com/docs/guides/api/securing-your-api

The companion is a development candidate pending exact Windows evidence, not a production seal or permission to bypass HOLD.

## 16:17 UTC continuation — current UAC boundary

Remote PR #1087 advanced from `38f71e0c` (20/20 workflow SUCCESS) to `06c8ef6440f57975e70aeaa72988133c07e04261`. The donor added protected packaged bootstrap metadata, an explicit SYSTEM activation bridge and a no-argument UAC executable entry. Package Smoke `36832190273` physically proved that entry, exact machine copy, Running SCM, repeat observation-only, policy/ancestor ACL drift HOLD, embedded tamper rejection and stopped-service HOLD. Proof explicitly keeps owner enrollment, installer dispatch and user-machine qualification false.

The current-head three red workflows share two exact causes: package version `0.7.0-dev.36832129848.1` differs from the stale reserved identity in this document's companion manifest; the bootstrap API-ban assertion matches the explanatory word `ShellExecute` instead of an API invocation. The successor keeps exact version equality and the API invocation ban, and reserves `0.7.0-dev.36832190273.1` above the consumed installer.

Critical launcher audit found an unbounded OS launch acknowledgement and a false `NO_EFFECT_PROVEN` classification after a thrown/lost response. Activation now bounds OS acknowledgement to 60 seconds (maximum internal configuration 120 seconds), returns AMBIGUOUS on a lost/deadline response and HOLD for an opaque failure message. Neither proves effect absence or causes automatic retry/enrollment. Concurrent activation calls share one launch. Three injected fault cases and all focused identity/launcher/IPC contracts passed (34/34).

Research: Electron `shell.openPath` reports OS integration failure/success, not a durable SCM/owner receipt: https://www.electronjs.org/docs/latest/api/shell . READY still requires independent native owner/device readback. No model API, second scheduler or remote privileged executor was added. New exact Windows qualification remains mandatory.
