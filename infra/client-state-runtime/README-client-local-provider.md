# Installed Client local provider

The installed `0.7.0-dev.37628000001.1` native-supervisor endpoint resolver supports
the existing `METAENGINE_SUPERVISOR_BASE_URL` environment variable. Set it to:

```text
http://127.0.0.1:15433/a2-browser-native-supervisor-v1
```

Start the exact installed Client executable normally with that environment
after the existing primary has exited normally. Do not use `--updated`, smoke
switches, a singleton bypass, a new profile or a different user-data directory.
Launching another process while the primary is alive only focuses the existing
primary; it cannot change the running primary's environment or provider.

The installed archive was inspected read-only on 2026-10-08. Its package version
is `0.7.0-dev.37628000001.1`, its entry is `src/final-runtime-entry.mjs`, and it
contains the environment override and fallback pinning contracts described here.
The verified executable is:

```text
C:/Users/User/AppData/Local/Programs/METAENGINE Browser Test/METAENGINE Browser Test.exe
```

The existing profile is `C:/Users/User/AppData/Roaming/@metaengine/browser-shell`.
Its generation marker already records `DEVOS_CLEAN_GENESIS_V2`, so a normal
restart of this same version does not apply another genesis reset. No installed
file, profile state or current process was changed during this inspection.

`client-local-provider.mjs` prepares a concrete normal-launch plan without
starting or terminating a Client. Its read-only preflight verifies the exact
local runtime instance, the local PostgreSQL provider contract and the existing
database capability attestation. Its environment builder pins the supported
endpoint variable, clears reserve failover configuration and removes database,
Supabase and local-runtime secrets. The browser needs its existing device key,
not the local database or internal API credentials.

## Existing source behavior

`native-supervisor-endpoints.mjs` accepts HTTP on loopback. The signing path
remains `/a2-browser-native-supervisor-v1`; moving from the hosted
`/functions/v1` URL prefix does not alter device signatures.

`main.mjs` passes `base_pinned_by_env=true` to the fallback console when this
variable is nonempty. `fallback-console-runtime.mjs` then refuses every automatic
base swap, including restoration to the cloud after local failure. The old
sentinel still sends read-only cloud health probes in this installed release;
the endpoint pin prevents those observations from changing the active provider.

`runtime-genesis.mjs` has no provider or host requirement. Its generation reset
preserves the supervisor device identity and Chromium session. Keeping the same
installed executable/profile preserves safeStorage access to the device's
existing P-256 key. The restored database must contain the corresponding enrolled
and authorized device; this launch plan does not approve or grant one.

## Remaining installed-release work

`self-update-signed-heartbeat.mjs` still recognizes only HTTPS heartbeats to the
old Supabase hostname. A local accepted heartbeat therefore cannot produce the
existing self-update successor qualification receipt until that source contract
is adapted and delivered through the normal release process. A normal cold
start does not bypass this restriction and the launch plan does not use an
updater-successor launch.

The shipped agent access capsule also contains an old cloud URL. That capsule
is advisory prompt context rather than endpoint authority. In the new explicit
local source profile it is replaced in memory with a provider-bound local map;
the historical operator file is neither read nor overwritten. The installed
release does not acquire this change from starting the server. Health sentinel
probes and self-update qualification also need normal source delivery before
claiming the installed release has removed every Supabase dependency.

The current source adds `explicit-local-supervisor-provider.mjs`: canonical local
selection omits the cloud health sentinel and reports cloud health as
`NOT_CONFIGURED`. The signed-heartbeat hook accepts only the selected endpoint
and additionally verifies the launch's `METAENGINE_LOCAL_STATE_INSTANCE_ID`
against local provider health and database capability attestation. The launch
plan carries that instance ID after its preflight. These source changes leave
publisher, release, device-signature and sentinel-worker checks in force; the
existing installed archive does not contain them until delivered normally.

The plan also sets `METAENGINE_STATE_PROVIDER=LOCAL_POSTGRES`. In the current
source this marker requires a canonical loopback base and a valid launch UUID
at module startup. Missing or malformed local configuration throws before a
cloud default can resolve, and `setNativeSupervisorBase` cannot switch the
selected endpoint. Legacy cloud and reserve behavior remains available only
when the explicit local provider marker is absent.

Sentinel recovery preserves the three normalized provider fields through its
restricted worker environment and refuses malformed local configuration before
spawning. It does not inherit database or internal API credentials. A marked
local profile does not register the bare installed executable as a Windows
login item: without durable provider configuration that path would lose the
selected environment. Host resilience reports
`LOCAL_PROVIDER_CONFIGURATION_REQUIRED` and a configuration hold instead.
No existing Windows login settings are changed by this source guard.

Persistent source startup now uses an owner-reviewed settings file at
`%APPDATA%/@metaengine/browser-shell/metaengine-state-provider-v1.json`, loaded
with top-level await before endpoint imports. `persistent-client-provider.mjs`
offers an explicit provisioning API for that external profile file. It stores
only the canonical local base and runtime-identity file location. Each launch
discovers the runtime's current UUID from its sanitized status and confirms
local health and database attestation. Invalid, conflicting or offline existing
configuration blocks startup with the local marker retained.

No profile file is created merely by importing source or starting the runtime.
Provisioning requires `ownerChoice: 'LOCAL_POSTGRES'`, an explicit owner file
path and profile data directory. Once this source is delivered and such a file
is provisioned, its verified startup profile qualifies the existing source login
registration path; the bootstrap itself never mutates Windows settings. A
runtime's PostgreSQL/API/Edge startup after reboot still needs its own reviewed
launch provisioning. Registering the Client executable alone does not start
that separate stack.

Run `node --test infra/client-state-runtime/client-local-provider.test.mjs` to
verify exact endpoint selection, secret separation, readiness checks and launch
arguments. Live provider acceptance and a signed device readback are separate
post-launch checks.
