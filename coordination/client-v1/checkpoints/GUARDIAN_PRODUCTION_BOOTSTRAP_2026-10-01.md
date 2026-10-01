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

## Verification at source checkpoint

Focused Node: 54 PASS, one existing Windows-only PowerShell parser case skipped locally. Installer provenance/upgrade/bootstrap: 35 PASS. Windows compile and physical qualification remain mandatory; local source checks are not native runtime proof.

Meta project: `jhriwwsryeqsvvvufkok`. Migration `browser_guardian_enrollment_ticket_v1` applied atomically with 14 SQL cases and fixture rollback. Body readback MD5 (source equivalence, not cryptographic authorization): issue `78d859006e01878d595a4a70692826fc`, consume `eef6d980a8bbd69a62edf147a20d6779`.

Installed user heartbeat at 04:09 UTC still reports `0.7.0-dev.36760350225.1`; this does not prove that the successor or Guardian companion is installed on the user's machine. No new live emergency update command or ambiguous-effect replay was issued.

Canary v26 is deployed at immutable source pin `5aaae3e6696eeee07c09a65ff467857aab67732b`, digest `878bb81e59109e93aa49492655c6d856668495c9e85d21c323978b59d9b46eb1`. A separate ticket-only, bounded stable-to-canary redemption adapter is necessary because LocalSystem carries no Browser identity header. It forwards only the exact redemption route, validates three bounded ticket fields and never manufactures device identity, retries or falls back. Its stable deployment requires separate readback.

## Required exit gates

One Package Smoke producer must build and package the companion, verify its exact source/hash binding, physically prove copy/ACL/SCM/Running, repeated observation only, embedded tamper rejection and stopped-service HOLD. Downstream Installed Chat, Final Runtime, Soak and Self Update consume the same Browser installer and require producer terminal success.

Edge source changes require a new immutable canary pin/deployment and source-equivalence readback. The ticket SQL migration alone does not make the new routes deployed. Stable promotion, owner enrollment on the user's machine, emergency installer handoff and genuine z.ai Agent useful-work remain separate live gates.

## Research basis

- Microsoft service security: only privileged identities receive service creation/configuration access; `SERVICE_CHANGE_CONFIG` must not be granted to ordinary users. https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights
- Microsoft application manifests: embed explicit `requestedExecutionLevel` in the executable; elevation belongs to the installer boundary. https://learn.microsoft.com/en-us/windows/win32/sbscs/application-manifests
- Microsoft PE resources: immutable packaged resource bytes can be loaded without accepting external filesystem inputs. https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-loadresource
- Supabase API security: combine restricted EXECUTE/table grants with RLS and explicit privileged function authorization. https://supabase.com/docs/guides/api/securing-your-api

The companion is a development candidate pending exact Windows evidence, not a production seal or permission to bypass HOLD.
