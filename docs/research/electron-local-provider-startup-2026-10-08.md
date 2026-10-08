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
too late. Provider setup must therefore be part of the static import graph,
with top-level await, before endpoint modules evaluate.

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

`final-runtime-entry.mjs`, `main-entry.mjs` and the endpoint module statically
import the awaited bootstrap. This also covers first imports of the signed
heartbeat module, updater successor starts and sentinel relaunches. The source
provisioning API requires an explicit owner choice and external profile path;
it does not silently provision the running user's profile.

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
