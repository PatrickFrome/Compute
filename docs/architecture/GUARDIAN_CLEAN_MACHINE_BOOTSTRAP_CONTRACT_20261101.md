# Guardian and first MAIN: mandatory clean-machine contract

Status: **SOURCE/STAGING CONTRACT. No installer, service, database, device key or
credential was created/executed by this work. Protocol review/publication remain
pending. This document does not qualify a Windows installation.**

User requirement: the installer must deploy, install, internally authorize and
connect the complete METAENGINE infrastructure on a completely new supported
Windows PC. Existing Guardian/PostgreSQL, global Node/Git/CLI/runtime tools and
an old userData/profile are not prerequisites or evidence. The recovery-only
checkpoint is a later lifecycle purpose; it does not satisfy first installation.

The noncyclic authority/issuer split and minimal private native interfaces are
specified in
[`GUARDIAN_FRESH_MAIN_NONCYCLIC_AUTHORITY_20261101.md`](GUARDIAN_FRESH_MAIN_NONCYCLIC_AUTHORITY_20261101.md).
First setup UI is an installation grant; project/task admission comes afterwards.
RootSession and the new `.node` observer are not first-launch prerequisites.

Fresh bootstrap implementation owner: cloud thread
`01a194c2-5ed5-740b-8ed2-2283dfc0700e`. This stream provides the first-Main/root/
enrollment/peer handoff contract and preserves its existing code scopes; it does
not duplicate that owner's installer/PG provisioning implementation.

## Existing producers and the actual gaps

| Source | Actual current behavior | Clean-machine consequence |
| --- | --- | --- |
| `browser-guardian-machine-bootstrap.cpp:installEmbedded` | Verifies embedded Guardian/configurator/manifest bytes; after legitimate elevation creates machine-protected slots, configures/starts its service and reads SCM back. Receipt explicitly says `owner_enrolled:false`. | This is a real absent-service deployment producer, not complete infrastructure/enrollment. Invoke the packaged installer path; do not require UI ADMIN state first. |
| `NSIS runAfterFinish` → `main-entry.mjs` fresh-provider branch | The existing installer starts a normal primary; before main/HostResilience imports, NO_OWNER_CONFIG with no attached descriptor calls `setupInstalledFreshProvider`. | This is a real first-setup producer, so there is no unavoidable whole-app device-enrollment cycle. It is not an already functioning recovery permission. Fresh acceptance must not adopt the attached-provider branch. |
| `installed-fresh-provider-setup.mjs` and bundled `fresh-client-provider.mjs` | Verify the owned offline bundle, acquire actual native consent, create a new private PG17 cluster/roles/schema/Vault/Owner profile and register the protected device as first local ADMIN. | Reuse this producer and its real identity/database checks. Its receipt explicitly leaves `guardian_ready:false` and `runtime_ready:false`. |
| `browser-guardian-machine-bootstrap-launcher.mjs:observePrepared` | Calls `guardianOwnerChallenge` before observing pipe absence; the loaded challenge requires an enrolled `device_id`. | An unenrolled clean profile cannot use this as the absent-Guardian installer producer. |
| `main.mjs` UI activate-guardian handler | Requires an existing ADMIN connection before activation. | This cannot be the only first-install route. Do not replace it with an unconditional allow flag. |
| Native enrollment ticket client | Deliberately returns `LOCAL_OWNER_BRIDGE_REQUIRED`; no accepted native redemption producer is mounted. | A real authenticated local bridge is mandatory. A local SQL receipt or signed device JSON alone cannot populate native owner custody. |
| `GuardianNativeRootSession` / W74 / same-version recovery | Require existing protected enrollment/Owner or a live original recovery transaction. | These are post-enrollment consumers. They cannot mint their own missing first-install authority. |

The installer must sequence the real stages below. It cannot instruct a clean
user to preinstall Guardian/PG or count manual Settings activation as complete
automatic internal setup.

## Ordered first-install producer/consumer contract

1. **Fresh preflight and authorization.** The actual signed installer verifies
   its existing release trust chain and all exact payload/source bindings before
   mutations. Preserve the original installer process/birth/token/session and
   explicit action-time Windows UAC/installation consent. Record actual absence
   of METAENGINE-owned services, registrations, config and data. An unknown or
   conflicting prior state is not fresh and must be preserved, not erased to
   satisfy preflight. Unrelated user PostgreSQL/Guardian installations are not
   adopted, stopped, reconfigured or removed.
2. **Deliver the complete owned payload.** Install verified Browser, Guardian
   service/configurator/bootstrap, native pipe-peer client, own PG17, Node/Deno,
   CLI/Git where required, job helper and their DLL/runtime/data/license closure
   from the authenticated package. Every later process uses an absolute path
   within its installed verified closure or a declared native Windows OS API.
   No install-time download of an unpinned runtime, build-on-launch compiler,
   PATH discovery or caller-selected module is a dependency substitute.
3. **Create protected owned locations.** Code at the existing fixed installed
   location must have machine-trusted owner/DACLs and read/execute access for the
   intended user; its LocalAppData location does not imply writable code is safe.
   Mutable runtime/PGDATA/config/device/user data stays outside that code tree,
   protected by its existing per-owner policy. Derive the interactive user and
   KnownFolders from the original native token/WTS session, not caller JSON or
   copied environment. New ports/services/paths belong to this installation.
4. **Deploy Guardian from packaged native bootstrap.** Use the real absent-service
   `installEmbedded` producer under the installation authorization and read its
   exact machine bytes/SCM/process identity back. Do not wait for an enrolled
   Browser or ADMIN UI connection in order to install this prerequisite. An
   existing-service no-op READY is not fresh-install evidence. Keep the
   installation transaction responsible for its own partial effects/rollback.
5. **First setup MAIN has a distinct purpose.** The proposed
   `BOOTSTRAP_FIRST_MAIN` scope must be minted only by the original authorized
   native installation transaction, against its just-deployed verified code and
   actual interactive token. It must not require a prior machine owner record,
   device key, Host project, recovery ticket or original Browser. It is not an
   arbitrary pre-enrollment start method and does not reuse update-installer
   permission as a general launch grant. A private native installer/Guardian
   scope retains original process/token/namespace/Job references; no
   `factory(path, verified)`, copied bootstrap JSON or guessed parent PID can
   construct it. This purpose and its peer/transfer handshake need the existing
   protocol review before implementation. Its only role is the packaged native
   setup composition; tasks/agents remain unadmitted.
   The original intended user must be retained before UAC; a different elevated
   administrator is not that user. Prefer Guardian creating the child itself
   after accepting original installation custody, before any Browser code runs.
6. **Provision own PG and first local identity.** The verified setup Main uses the
   actual bundled fresh-provider operator to initialize owned PG17, roles,
   restricted API credentials, schema/migrations or approved packaged baseline,
   protected config and the existing secureStorage device identity. Never import
   a global database URL, existing cluster, old userData or an external identity
   into the fresh transaction. The existing manual-first-run native consent path
   remains valid. To make installer-driven setup automatic, carry real original
   installation consent through an opaque authenticated install scope; do not
   remove consent checks or add `skipConsent:true`/injected signer/credentials.
7. **Complete authenticated local Guardian enrollment.** The existing owned Host
   and first-ADMIN device producer must be joined to Guardian through a real
   authenticated local bridge bound to the installed code, own PG identity,
   original setup Main PID/full birth, SID/session/logon and exact device key.
   Guardian creates its protected owner tuple only after that independent
   producer, then verifies a new P-256 challenge and durable readback. Do not
   populate the store from the install receipt, localhost URL or SQL JSON alone.
   No native numeric Owner epoch is invented; project/epoch authority remains
   with the actual own-PG/Host scopes when a real goal is admitted.
   A proposed bounded bootstrap issuer may authorize only this first OS-owner/
   device binding under the original install/child scope after real fresh PG
   enrollment. It is a separate explicit purpose, not an implemented shortcut
   through the existing ADMIN-ticket route; legacy redemption remains closed.
8. **Transfer to normal installed operation.** Retain the original first Main/
   namespace ownership through authenticated transition to the service-owned
   lease. Machine-root/session consumers can run only after actual enrollment.
   The local runtime starts from packaged absolute paths and verifies its own PG
   postmaster/system identifier, roles/schema, restricted API login, signed Host
   binding, Guardian peer and health. A setup receipt, process creation, open
   port or exit code zero is not final client readiness.
9. **External user steps remain explicit.** GPT/Codex external login and Windows
   UAC use legitimate user interaction. Missing/failed external login is an
   AUTHORIZATION_PENDING/HOLD state, not successful automatic authorization.
   Internally deployed infrastructure may be reported separately, but never as
   all-required client/agent readiness while a required login is missing.
10. **Finish or preserve owned failure state.** Only exact joined health and
    authorization evidence closes installation. On failure/cancel, stop/drain
    only original owned processes, compensate only proven-created resources and
    preserve original receipts, cluster/Vault/data identity and unresolved
    outcomes. Unknown results are HOLD/reconcile-only, not deletion/retry or
    successful rollback. No cleanup touches unrelated services/data. The
    current fresh-only installer does not stop Guardian. The potential future
    replacement/SCM-STOP custody cycle needs exact terminal completion OR a
    physically checked original-handle transfer to an already running approved
    owner before STOP; a blanket wait for installer exit is forbidden.

## Exact component interfaces for this stream

- **Installer → first-Main producer:** a real original authorized native install
  scope and exact deployed payload identity. This is the new first-install
  producer; existing `NativeRootSession` cannot be used to approve its own
  missing owner. The current stage1 API stays post-enrollment/default closed.
- **Native pipe client → Guardian peer:** kernel identity of the actual
  connected fixed pipe, compared with original SCM Guardian PID/full birth/
  protected image. Bootstrap/ARM responses cannot request origin quit or
  publish setup success through an unauthenticated `net.Socket` JSON response.
- **Own-PG fresh operator → enrollment bridge:** real fresh cluster/system
  identifier, installed bundle/source, actual approved first device, exact
  setup-Main incarnation and joined native/SQL scope. This is a producer
  contract; no boolean receipt or existing arbitrary PG login satisfies it.
- **Enrollment bridge → normal root/session:** protected native owner tuple and
  independent device/token readback. Only then can the existing post-enrollment
  RootSession manufacture its internal lifetime-bound namespace scope.
- **Existing recovery → later MAIN restart:** the separate same-version
  recovery purpose from the other checkpoint applies only after first bootstrap
  is complete. It grants no task/goal admission and no first-install fallback.

## Concrete packaging gaps to route, not hide with system fallbacks

At this source, `offline-runtime-bundle.mjs:validateRecords` requires postgres,
psql, initdb, pg_ctl and pg_config but omits **pg_isready.exe** and
**pg_controldata.exe**. The actual fresh path uses them in
`owned-postgres-process.mjs:215` and `fresh-client-provider.mjs:348`. A declaration
accepted by that inventory can therefore be incomplete on a clean PC. PG/package
owners must include both executables and their dependency closure in the exact
authenticated inventory; absence must fail package qualification before install.

The visible offline component allowlist also does not own CLI/Git executables;
external operator pins must not silently become machine prerequisites. CLI/build
owners must supply required binaries and runtime closure. Build-host MSVC/Node/
Git tools are not evidence that these exist in the resulting client package.
The native pipe-peer artifact now has build/packaging source at local `3f86445a`.
Its production load still returns HOLD before require; delivery is not qualified
module loading or first-Main authority.

## Required acceptance evidence

| Evidence lane | What it can establish |
| --- | --- |
| Source/unit/packaging | Canonical contracts, missing-file refusal, absolute owned paths, signatures/inventory and bundle completeness. It does not establish clean Windows installation. |
| Hosted Windows runner | Actual Windows APIs/MSVC/SCM/package mechanics with declared image prerequisites. Its preinstalled developer tools are not a clean-machine proof. |
| Clean supported Windows VM | Proved initial absence of METAENGINE state/services and third-party Node/Git/CLI/PG dependencies; install the exact verified artifact; observe first bootstrap, internal enrollment, own PG/Host/Guardian and required user login transitions. This is the mandatory acceptance lane. |

The clean-VM harness must run the delivered installer rather than seed an Owner
profile, restored descriptor, PG cluster, preinstalled Guardian or developer
runtime. Record original VM/image and exact source/artifact hashes. Audit every
executed binary/module path and its package ownership; run a separate poisoned
PATH/decoy-tools negative to prove no global fallback. Test missing payloads
(including both PG tools), denied UAC, failed/cancelled login, interrupted
bootstrap/enrollment, duplicate/replayed scopes, foreign PG/service/port
collisions and rollback with original data/receipt preservation. No scenario may
clean foreign state in order to turn itself green. Immutable code/DLL/provider
custody and actual Windows first-Main/Job/pipe-peer/stop tests remain required.

All listed capability/readiness results are observations requiring their real
producer and independent verification. This contract is not runtime authority,
an installer-ready release or full loaded-code/V8 attestation.
