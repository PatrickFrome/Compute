# Client launch qualification, 2026-10-10

This candidate extends the autonomous/recursive project continuity client with
existing PostgreSQL onboarding and installed launch qualification. The source
checks, runtime contract tests and successful packaging are separate evidence.
A candidate is ready for release only after every required physical gate below
passes for its exact source head, version and immutable installer.

## Required stages

| Stage | Acceptance evidence | Current implementation |
| --- | --- | --- |
| Existing Keeper admission | Exact cluster identity, separate physical paths, explicit owner action, pinned SQL sources, no initialization or postmaster ownership | Attached onboarding CLI; live Keeper remains untouched during development qualification |
| Restricted API connection | Independent SCRAM reconnect, 50 RPCs, direct column grants, RLS, no elevated flags or memberships | Direct API role provisioning and fail-closed startup; disposable schema-only and public migration fixtures |
| Bundled offline execution | Verified bundle's Node/PG17/Deno, onboarding CLI without injected admission, attested API/edge health on two host starts, confirmed cleanup | Opt-in physical attached bundle fixture; its results must identify the actual bundle digest |
| Launch and recovery | No READY after owned host exit; preserved PG incarnation, Vault and saved transcript boundaries | Host lifecycle fences and regression checks; attached PG is externally managed |
| Installed first launch | Immutable installed ASAR opens the isolated setup wizard without contacting a hosted provider | Required isolated installed launch gate; a wizard screenshot does not attest Owner boot |
| Normal installed UI | Installed UI host, real Windows listener readback, 127.0.0.1 and expected child PID | Required installed UI/socket gate and separate normal Owner qualification |
| Installed Owner admission | Real full schema fixture, private owner configuration, ordinary client entry, health and rendered UI; no fake owner or bypass flags | Must be exercised separately with a disposable local schema fixture; public synthetic RPC bodies do not qualify this stage |
| Package identity | Frozen toolchains, exact source SHA, unique version reservation, runtime source binding, ASAR/fuses/post-build verification | Windows NSIS package workflow; consumed versions require a new version/source for another physical attempt |
| Deliverable verification | Downloaded artifact digest, distinct extracted installer SHA256, size/version and qualification receipts | Required before reporting a verified installer; archive digest is not installer digest |

## Critical findings addressed by this candidate

The previous working schema provided 40 of the 50 exposed RPCs. Three
managed-project and seven project-continuity RPCs were absent. The new migration
catalog validates complete function signatures, relations, RLS and required
enabled trigger identities. A partly installed group is rejected instead of
being silently rewritten. Existing complete function bodies are not attested
by this catalog check.

The only verified local probe login was a superuser. The new API login has no
role memberships, cannot SET service_role, and receives direct RPC/column grants
with role-specific RLS policies. SQL PUBLIC privileges elsewhere in the database
remain an explicit limit: the result does not certify a database-wide privilege
allowlist. Application authority semantics require behavior tests as well as
catalog checks.

Onboarding commits migrations and role creation together, then independently
reconnects before publishing a private config. A reconnect or publication error
after commit can leave database effects. Such an attempt retains its review lock
and does not automatically retry or drop the new role. State-directory locking
does not claim ownership of every other user of a shared Keeper cluster.

The startup controller previously allowed an owned host to exit during health
response decoding and then be recorded as READY. An exact owned-host liveness
guard now fences the final READY transition. An IPC READY immediately followed
by process exit also rejects admission.

Physical bundled qualification also exposed different source closures in the
packaging inventory and the launcher's runtime capture. The launcher now
includes the remote-support entry and its computer/provider dependencies. The
regression test rejects the previous capture with startup_files_pin_mismatch
and verifies agreement with the build inventory after the fix.

The installed wizard can rebind an already provisioned attached/direct config
to the installed bundle without copying PGDATA or taking over Keeper's
lifecycle. It verifies private ACLs and mode/cluster pins, secures only the
separate client state and requires truthful attached lifecycle fields in the
operator receipt. First-run ESM evaluation is released before waiting for
Electron readiness; Browser and ME2 activation remain behind provider admission.

The ordinary UI launch explicitly selects 127.0.0.1, including the source Next
CLI path. Physical qualification reads Windows TCP listeners and rejects
wildcard/LAN/IPv6 addresses and a foreign PID. A command-line hostname alone is
insufficient evidence of the listening socket.

## Qualification boundaries

The working Keeper and the existing installed client profile are preserved.
Disposable full-schema qualification restores schema only from a pinned local
archive, verifies every restored table is empty and does not upload archive
contents or private configuration to GitHub. Public CI uses synthetic baseline
RPC bodies and exercises the real managed-project/continuity migrations.

First-run, installed UI/socket and normal Owner qualification are different
checks. A missing, skipped or unqualified Owner gate leaves release readiness
blocked even when the installer builds successfully. No development installer
is promoted automatically to the existing user installation or production.

Evidence generated by CI must retain the source head, package version, installed
ASAR identity, relevant bundle digests and each gate's outcome. Local evidence
must distinguish fixture health from the unchanged working Keeper. The draft
PR remains a candidate until all required gates and delivery hashes are verified.
