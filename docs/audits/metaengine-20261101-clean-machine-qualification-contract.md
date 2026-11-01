METAENGINE clean-machine installation qualification

The mandatory target is one installer that delivers and connects Browser,
Guardian, its own PostgreSQL 17, GPT/Codex CLI, Git where required by the coding
worker, and their runtime dependencies on a new Windows PC. Existing Guardian,
PostgreSQL, global developer tools, operator configuration, credentials or
userData cannot supply missing installation inputs. GLM is outside acceptance.

This document specifies acceptance and integration work. It does not authorize
installation, service changes or credential creation. Current work is source and
staging only. Unit tests, packaged-file checks and a hosted Windows runner are
separate from real clean-Windows installation evidence.

The read-only prerequisites observer is
`apps/metaengine-browser/scripts/observe-clean-machine-prerequisites.ps1`.
Run it with the fixed OS Windows PowerShell 5.1 executable, `-NoProfile` and
`-NonInteractive`; it needs no Node, Git, CLI, PG or Guardian executable. It
observes known service/registration/path footprints and command resolution
without invoking discovered tools or modifying the machine. An inaccessible or
ambiguous observation is UNKNOWN, never ABSENT. A present empty product directory
is still PRESENT. Its output is OBSERVATION_ONLY and always denies installation
qualification, authenticated baseline and runtime readiness.

`PRECONDITION_CANDIDATE` means only that the current-user and fixed machine-root
inventory did not find a conflicting footprint, developer tool or runner marker.
It does not attest a new OS image, all other user profiles, loaded observer code,
or absence of software outside that inventory. The native qualification runner
must additionally bind an independently authenticated fresh Windows image/VM
baseline and complete user-profile coverage. Caller-supplied booleans, empty PATH,
a fresh APPDATA directory, clearing CI variables or a hosted runner image do not
establish that baseline. Raw observations remain private; shared results contain
only approved bounded facts and evidence digests.

The observer is a qualification prerequisite, not a general installer
eligibility policy. A user's unrelated PostgreSQL or Guardian installation must
remain untouched. Its presence prevents classifying that test as a completely
clean-machine test; it never authorizes stopping, deleting, reconfiguring or
borrowing the other installation. A separate coexistence scenario must establish
that the new installation owns its distinct paths, service identity and ports and
preserves the unrelated service/data preimages.

The following stages are sequential. Later success cannot erase a failed,
missing, skipped or ambiguous earlier stage.

| Stage | Required observations before advancing |
| --- | --- |
| Package admission | Existing authentic release/build chain binds the exact source, version, installer, all shipped payloads and dependencies. Required signature/provenance verification succeeds and the producer is terminal-success before the installer starts. No package build or version reservation is performed by the consumer. |
| Clean baseline | Fresh OS/image and runner identity are independently bound. Before the first product effect, all intended METAENGINE services, registry registrations, config, data, operator files and userData are absent across the required user/machine scope. Global Node/npm/npx/Git/Codex/Bun/Deno/PG tools cannot supply dependencies. The read-only observer receipt is bound to this run and machine but is not itself the trust root. |
| Payload deployment | Browser, Guardian bootstrap/service, own PG17, CLI/Git and every required runtime are installed from the admitted package. Exact installed paths and file identities/digests match its manifests. No global executable, downloaded unverified runtime or other installation is selected. The native observer binds actual loaded code and the complete descendant process tree. |
| Protected local provisioning | The installer creates its own private directories/configuration, local database roles/credentials and schema through the existing trusted provisioner. Own PGDATA and cluster identity are new, bound to this installation, and distinct from user databases. Execute the registered migrations or authenticated canonical restore, preserve ACLs and verify exact catalogue/readback. No retained Owner, operator JSON or test DB fixture is injected as first-run state. |
| Guardian bootstrap/enrollment | The packaged bootstrap performs the secure machine copy and service configuration through legitimate UAC. The existing authenticated native enrollment/ticket chain binds this local Owner, device, user and service incarnation. Service-running or disk-manifest equality alone is insufficient; no test ticket, fabricated verified flag or new signing root substitutes for that chain. |
| Component binding and health | Installed Browser, Guardian, own PG17 and coding worker share the current device/profile/runtime generation and exact payload identities. Fresh health/readback binds real listeners/process births, protected Owner/operator files, roles/schema and sandbox receipts. No hosted state fallback or inherited READY state is accepted. |
| External GPT/Codex authentication | Use the legitimate supported external login/user-consent flow when required. Missing, cancelled, expired or failed login is PENDING_EXTERNAL_LOGIN or failure, never successful automatic authorization. UAC and external login are legitimate user steps; internal component authorization remains automatic through the existing trust chain. |
| Functional startup and restart | The normal installed entry point exposes the native Browser UI and performs a small real GPT/Codex-backed workflow. Stop/drain and cold restart/reboot use the installed entry point and the same own cluster/profile. New process/boot identities and repeated persisted sentinel/artifact readback prove preservation and no duplicate Host/PG or effect replay. |
| Fault recovery | Inject failures at payload copy, service creation/start, roles/schema/migration/restore, Owner/operator publication, enrollment and final health boundaries on the disposable approved machine. Observe exact restoration or an explicit retained unknown state; then prove predecessor/clean-baseline recovery and unchanged unrelated infrastructure. Installer exit zero is not rollback evidence. |

Installation evidence must include the actual command/process identity and
timestamps for each stage, existing package/runner provenance identifiers,
machine/boot identity, precondition observations, installed payload fingerprints,
own cluster identity, protected configuration/Owner/enrollment bindings, real
health/listener and UI observations, external login outcome, and recovery phase
readbacks. Bind phase records by their actual byte digests to one source/package,
machine and run. A serialized document without authentic producer/observer
custody cannot satisfy any stage. No new helper here emits a final clean-install
PASS or starts the installer.

The observer must run before installer effects and be rechecked immediately
before first dispatch. The installing actor must serialize that dispatch against
the same machine/package/attempt and refuse stale baseline, competing service,
config or data creation. After an uncertain installer outcome, retain the exact
attempt and inspect its effects before any retry. Do not interpret a missing
acknowledgement as proof that installation did not run.

The no-preinstalled-tools check must include the actual process tree, loaded
runtime/module origins, service ImagePath and command resolution while the
installer and installed client run, not just the initial PATH. Tests must cover
absent global tools and a separate hostile/global-tool shadow case. The latter
must never execute the shadow tool. Record attempted nonloopback fallback across
the process tree; Chromium proxy flags and positive local health alone do not
prove that fallback was never attempted. Windows OS components used legitimately
by the package, including Windows PowerShell/.NET where supported, must have
their actual minimum version and provenance requirements in the existing payload
dependency policy. Build-machine Node/Bun/MSVC requirements are not client
runtime prerequisites.

Fresh installation does not require a predecessor installer/image, old own
database, retained config, earlier local signing key or device identity. Any new
device identity/key must be legitimately provisioned and enrolled through the
existing trust chain on this new machine; copying an older device's signing or
enrollment state is not qualification. Publisher/package verification and new
local device enrollment are different responsibilities. Previous own-installation
state belongs exclusively to a separate upgrade scenario and cannot substitute
for the clean baseline.

For failed first installation, rollback concerns only effects created by that
attempt and must restore the demonstrated absent product baseline, with unrelated
infrastructure untouched. Predecessor-image/Owner restoration and predecessor
functional restart are additional upgrade tests, not prerequisites supplied to
the fresh installer. A failed or ambiguous cleanup remains explicitly unconfirmed
until independent readback establishes its outcome.

Current source interfaces that parallel owners must complete are concrete:

* `browser-guardian-update-actuator-client.mjs:ensureOwnerBound` currently stops
  fresh binding with `GUARDIAN_LOCAL_OWNER_BRIDGE_REQUIRED`. The authenticated
  native bridge must consume the existing single-use enrollment contract and
  produce fresh bound readback. Do not restore the legacy hosted enrollment path.
* `main.mjs` mounts native coding only when a protected
  `native-coding-operator-v1.json` already exists. The clean installer provisioner
  must produce it through the existing Owner/PG authority, with packaged CLI/Git
  identities, private work directories and genuine per-role sandbox receipts;
  it cannot depend on a manually prepared operator file or global executable.
* The package currently includes the Codex job runner/manifest, but its resource
  list does not by itself establish delivery of the coding CLI and Git binaries.
  The packaging owner must bind that complete runtime payload to the same
  admitted release before any clean-machine install claim.
* `src/me2/me2-ui-host.mjs` normally uses packaged standalone UI and Browser's
  embedded Node, but still exposes environment/development selection and PATH
  `bun` fallback. Packaged acceptance must prove those selections cannot replace
  the admitted installed closure; missing standalone resources must fail instead
  of borrowing global tooling. This is distinct from legitimate build/dev use.
* `github-repository-connection.mjs` currently discovers installed Git Credential
  Manager or a retained encrypted token. If repository connectivity is required
  by the accepted workflow, provide a legitimate fresh-user authentication path;
  neither source may be assumed present on a new PC. This is external account
  authentication, not permission to create fabricated credentials automatically.
  The separate `github-chat-setup.mjs` already provides an isolated local form
  for a user-supplied token and encrypted storage; reuse that legitimate surface
  where applicable rather than claiming no authorization surface exists.

Reuse the existing own-PG first-run provisioner and packaged Guardian bootstrap
instead of creating competing provisioners. The package already stages
Node/Deno/PG17 and Guardian resources; those are not missing preinstalled tools.
Their presence still requires authentic package and loaded-runtime qualification.
Currently the provisioner is entered from normal interactive packaged Browser
launch, not from an installer orchestration. It requires the existing native
consent path, Windows Forms, an authenticated non-System same-session desktop and
the fixed `C:\Windows` host paths. The production bootstrap owner must integrate
that real authenticated consent and state transition into installation, or
explicitly support the actual OS layout through the existing trusted mechanism;
a fixture consent flag is not a substitute. A prerequisite observation does not
claim those provisioner/desktop compatibility checks have passed.

The earlier `6839...` canonical exporter manifest is retained unchanged. Its
four-file exporter inventory does not satisfy the strengthened seven-file
inventory. A fresh native PG17 export and independent restore must produce new
manifest/artifact pins from the final integrated exporter source. Any newly
integrated implementation also needs its own current source seal and Windows
qualification; prior results retain their original scope.
