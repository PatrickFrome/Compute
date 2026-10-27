# Fresh local first-device owner enrollment

This is the installed Browser's **first local database** path, not an attached
or restored database migration and not a public approval service.

## Trust and composition

The admitted primary verifies the offline bundle and awaits Electron readiness.
It uses the actual `app.getPath('userData')` beneath the current owner's physical
APPDATA directory, the existing `metaengine-native-supervisor-device-v1.json`
filename, and Electron `safeStorage`. The verified bundled identity class is
used for this operation; normal main later reloads the same file and key.
Constructing the identity does not create a key. `ensure()` runs only after the
fresh operator's native owner consent. Declining native consent does not create an identity
or database namespace. Corrupt, unreadable, replaced, linked or mismatched key
state is not permission to generate a replacement. First creation is exclusive.

The installed setup wrapper is native-only, not a renderer API. The operator
accepts no signer, storage, app or identity-path override. Only after native
consent does the actual Electron browser lane import the exact conditional
`fresh-provider-native-device-identity.mjs` adapter. That no-argument adapter
obtains the real Electron `app` and `safeStorage`, requires packaged/ready/main/
singleton context and selects the actual canonical profile. Its bare Electron
built-in import is explicitly inventoried at this one module path, never hidden
behind an untracked loader and never installed as an offline Node npm dependency.
The direct Node CLI never loads it and remains schema-only. No caller-supplied
SQL connection, verifier, consent callback or approval boolean is accepted by
the production operator.

Native consent explicitly covers fresh private PostgreSQL/schema/Vault creation
and, for installed Browser setup, registration of this Browser's protected key
as the first local ADMIN. The operation creates `state_owner` credentials itself
and verifies the fresh cluster before using them. Credentials never enter argv,
renderer IPC, returned receipts or diagnostic output.

The normal owned runtime is started before enrollment. A new reserved owner
connection is pinned to its actual PG17 cluster, data directory, postmaster
incarnation and backend, rather than to the stopped initialization postmaster.
The existing signed HTTP enrollment route creates a PENDING request. The private
owner transaction locks and checks that exact request's ID, client, full public
JWK, fingerprint and precise database timestamps, rejecting existing devices and
competing requests. It invokes only the existing
`h205f22_a2_browser_device_enrollment_approve_v1(uuid)` procedure. That procedure
remains absent from the public RPC allowlist and inaccessible to the API login.

The existing signed status route performs activation. Both private SQL readback
and an actual device-signed `/v1/admin/status` readback must prove the same
client/device, current ADMIN grant and CONTROL_PLANE + DEVOS scopes. No synthetic
ADMIN row is inserted. Only then may setup return `device_enrolled:true` and
`admin_ready:true`. **Guardian and execution readiness remain false**; their
existing independent admission and native permit requirements are unchanged.

## Interruption and cleanup

The owner-only install journal binds the package digest, cluster/runtime identity,
client/key, exact request, expiry and (once available) device ID before each
potentially ambiguous transition. No approval/activation retry is automatic.
Unknown COMMIT, lost activation/readback, expired request, changed identity or
runtime leaves the namespace/journal for review. A prior journal is never a
second install attempt, and existing identity bindings are never cleared to make
first-owner setup proceed. Any approved but unconfirmed request remains bound to
that exact key and its original bounded expiry, not reusable approval of another
request. The temporary host is owned and stopped inside the imported operator;
main's separate controller instance is not assumed to own it.

## Verification boundary

Focused Node tests cover storage preservation, setup/profile validation, native
consent contracts and fail-closed identity/cluster admission. The supplemental
`fresh-device-owner.integration.test.mjs` uses a factory-owned PG18 WASM database,
the actual Edge source with TypeScript stripping only, real device signatures,
the API SQL compiler/grants and actual approval/activation/ADMIN functions. Its
transport is in-process and storage encryption synthetic: this is **not**
Windows, DPAPI, PG17 or independent-session qualification.

The same test file includes an opt-in native PG17 fixture selected only by
`METAENGINE_PG_TEST_BIN` and `METAENGINE_PG_TEST_DRIVER`. It creates/destroys its
own cluster with generated SCRAM credentials and separate owner/restricted API
connections; it accepts no existing database URL. It still uses in-process Edge
transport and synthetic identity storage, so full installed Windows first-run
qualification remains separate. Bundle source inventory/manifests and pre-ready
Electron protocol initialization must include this source before release.

No user database, native PC effect, external model/API call or real credential
is needed for these tests.
