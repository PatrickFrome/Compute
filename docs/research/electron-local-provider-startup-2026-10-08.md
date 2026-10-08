# Electron persistent local provider startup

Research date: 2026-10-08. Official Electron documentation was retrieved
read-only. No Windows login settings, installed archive, Browser primary or
owner profile was changed during this work.

## Documented behavior

Electron's Windows `app.setLoginItemSettings(settings)` accepts `path` and
`args`. The default path is `process.execPath` and the default argument array is
empty. It does not provide an environment-variable setting. The `enabled`
option can change the Startup Approved registry state, so the local provider
bootstrap itself does not call that API or rewrite Startup Approval.

Sources:

- https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings
- https://github.com/electron/electron/blob/main/docs/api/app.md

Electron's main process uses Node.js ESM. Its documentation requires awaiting
promises needed before the `ready` event and explains that entrypoint static
import side effects run before that event; an unawaited dynamic import may run
too late. Provider setup must therefore finish through an awaited entrypoint
import before endpoint modules evaluate.

Sources:

- https://www.electronjs.org/docs/latest/tutorial/esm#you-must-use-await-generously-before-the-apps-ready-event
- https://github.com/electron/electron/blob/main/docs/tutorial/esm.md

## Project consequence

The previous environment-only selection was lost by a bare executable login
start. Sentinel's restricted environment also originally removed the provider
marker before crash relaunch. Source fixes now preserve validated provider
fields during sentinel recovery and keep unprovisioned local login starts under
`LOCAL_PROVIDER_CONFIGURATION_REQUIRED` rather than registering an ambiguous
startup path.

The new owner configuration is loaded from the existing profile root before
network endpoint resolution:

```text
%APPDATA%/@metaengine/browser-shell/metaengine-state-provider-v1.json
```

It contains a strict schema, version, profile, `LOCAL_POSTGRES` provider,
canonical `http://127.0.0.1:<port>/a2-browser-native-supervisor-v1` base, local
runtime-identity file path and `authority_effect=false`. It contains no database
password, internal API key, device key or release credential.

The bootstrap marks the selection local as soon as that file exists, validates
it, reads the current `READY` runtime identity, and checks bounded local health
without accepting redirects. Health must match the current UUID and the
existing database capability attestation. Invalid, unreadable, offline,
unattested or conflicting configuration rejects startup before cloud endpoint
resolution. The owner file binds the runtime location rather than a permanent
UUID, so a verified local runtime restart can supply its new UUID.

`main-entry.mjs` first acquires the process singleton through a provider-free
import graph. An installer control launch stays in the guard's bounded signaling
path; a losing secondary reads only the existing primary's local activation ACK.
Neither path reads the provider files, probes health, imports Browser runtime or
starts another local stack. An admitted primary awaits the provider bootstrap
before dynamically importing HostResilience, signed heartbeat and other modules
whose static dependencies resolve supervisor endpoints. The endpoint module
retains its own awaited bootstrap for direct consumers. `final-runtime-entry.mjs`
installs activation hooks before entering this same admission path, and omits UI
recovery for installer control. This also covers updater successor starts and
sentinel relaunches. Awaited entrypoint imports complete before Electron's ready
event; the one-shot host bootstrap still releases the existing window barrier.
The source
provisioning API requires an explicit owner choice and external profile path;
it does not silently provision the running user's profile.

An owner can additionally supply `runtime_host` with exactly
`bundle_directory`, `expected_bundle_sha256` and `config_file`. The
`provisionPersistentClientProvider` API accepts this as its optional
`runtimeHost` argument. The public owner file stores only absolute canonical
resource/config locations and an expected offline resource digest. Browser
passes the private config's location to the host in
`COMPUTE_RUNTIME_HOST_CONFIG`; it does not read that file, inherit database
credentials, service tokens, Node loader flags or Browser provider identity.
External already-running local providers retain the original configuration
shape when this optional descriptor is absent.

For a managed host, the admitted primary verifies the entire resource bundle
before spawning its bundled Node executable. A packaged Browser also requires
its protected `app.asar` metadata to bind the package version, source head,
manifest bytes, source/dependency inventory and the builtin-only verifier
bytes. It executes those hash-checked verifier bytes directly. The external
bundle cannot select another verifier or replace itself with a different
internally consistent manifest.

The host's public ready descriptor must match the configured local endpoint
and identity-file location. Its UUID must then match both the runtime identity
file and fresh bounded health before endpoint-dependent Browser modules load.
Startup failure, descriptor mismatch or unavailable resources stops the newly
owned host and blocks local startup with a fixed diagnostic category. Raw
private stderr and filesystem error paths do not reach Browser startup logs.
Readiness is bounded at 120 seconds and owned cleanup at 45 seconds. Cleanup
that cannot confirm exit reports `CLEANUP_UNCONFIRMED`; parent disconnect
triggers the host's cleanup path without killing it while it owns children.
Unexpected host exit blocks the local readiness marker and does not start a
replacement writer or cloud fallback. Electron quit waits for the existing
owned host's cleanup attempt and keeps the primary alive if cleanup is
unconfirmed. The Browser does not restore or initialize a
database through this path.

The primary registers an installer shutdown barrier immediately after singleton
admission and before its first provider import await. The guard cancels its live
continuity watchdog at the signal, waits for primary preparation and any ongoing
HostResilience startup, confirms managed host exit and stops HostResilience
before it arms the existing five-second Browser exit fallback. A signal during
provider startup fences later UI/HostResilience startup. Cleanup failure leaves
the primary alive with startup held; an explicit later installer signal can
retry cleanup. Secondary and installer-control processes still use the
provider-free signal path.

For a package containing managed runtime resources, the NSIS preflight allows
240 seconds for graceful shutdown, polls the exact installed Browser and pinned
Node/Deno/PostgreSQL executable paths, and aborts replacement if any remain. It
does not force-kill managed processes after a timeout. The original narrow
exact-Browser-path force fallback remains only for legacy installations that
lack the managed resource directory. This prevents Browser disappearance from
being mistaken for confirmed owned runtime cleanup.

A missing owner file preserves legacy startup behavior. An existing owner file
does not permit a cloud fallback. Provisioned, attested profile state can
qualify the existing source login-registration path because the next bare
executable start reloads the same provider file. Actual login-item registration
and package/release installation still require their normal reviewed workflow.

## Verification

`persistent-local-provider-boot.test.mjs` uses actual separate Node processes
and isolated profile files. It covers normal boot without provider environment,
signed-heartbeat-first module import, successor and crash arguments, refreshed
runtime UUID, malformed and oversized files, forbidden fields/userinfo,
configuration conflicts, missing/stopped identity, health mismatch, offline
runtime, redirects, no-file legacy behavior and explicit provisioning. Combined
provider, sentinel, login and signed-heartbeat checks passed 40/40 tests.

The tests operate on temporary profiles and an isolated local HTTP fixture.
They do not prove that the installed old archive contains the new source or
that the machine will run the PostgreSQL/API/Edge stack automatically after a
reboot. That separate runtime launch and release delivery must be verified.

`local-provider-singleton-admission.test.mjs` adds 22 passing subprocess tests
against both actual entrypoints. Mock Electron supplies singleton ownership and
a matching durable ACK; the production bootstrap, endpoint pin and ACK reader
remain real. Stopped, malformed and offline profiles cannot block a secondary
or installer control signal. Primary startup verifies delayed health and a
refreshed runtime UUID before endpoint evaluation, rejects stopped/malformed/
offline/mismatched health with a local diagnostic, preserves exact offline
probes and legacy no-owner startup, and arms the ready continuation once. Browser
UI, Sentinel and watchdog doubles prevent effects on the installed application;
these tests do not claim a physical installed cold start.

The added managed-host cases use an actual inert Node subprocess with the
production controller's IPC, environment and quit handling. They prove that
only an admitted primary reaches the verification/spawn path; managed-host
failure and an IPC/file UUID mismatch prevent Browser runtime imports; a
normal quit confirms the owned child's IPC stop; and secondary or installer
control launches do not start a provisioned host. The 11 controller tests cover
protected package metadata, descriptor rejection, pin failure before spawn,
private environment isolation, startup timeout, spawn failure, bounded cleanup
and unexpected process death. The 2 owner provisioning tests cover explicit
managed descriptors, compatibility and replacement choice. This focused set
passes 35/35 tests. Full database lifecycle and offline bundle verification are
covered separately by the runtime and packaging suites.

Two added entrypoint regressions exercise installer signals both after boot and
during pending host startup. A real inert child delays its stop acknowledgement
while the fake Electron quit deliberately stalls. The accelerated forced-exit
timer cannot be armed until the child's `STOPPED_BY_OWNER_IPC` evidence exists.
Guard tests additionally prove that a pending cleanup barrier prevents both
quit and fallback, and a failed barrier retains the primary without publishing
private errors. Mocked PowerShell tests independently cover the managed NSIS
graceful path, orphan detection, timeout and unavailable process inventory.

`--metaengine-smoke` and `--metaengine-devplane-smoke` retain the existing
singleton bypass for isolated diagnostic execution. They still validate a
selected provider and the runtime's separate owner lock; they do not qualify a
normal installed primary launch. The exact five non-runtime probe flags and
installer shutdown remain offline. Installed startup, physical reboot/login,
release delivery and publisher provenance require their own evidence.
