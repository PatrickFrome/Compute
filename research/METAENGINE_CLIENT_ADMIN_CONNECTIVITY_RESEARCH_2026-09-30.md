# METAENGINE Client ADMIN Connectivity Research — 2026-09-30

## Scope

This research addresses the installed Client requirement:

> the Client must have administrative access and connect without manually entering infrastructure tokens.

The target is deterministic connection/recovery behavior while preserving the existing single Native Supervisor control plane. It does **not** claim that software can guarantee external Internet/Supabase availability.

## Live source-of-truth

Qualified UI parent:

- PR #1084
- source: `b1dc649b694bc60478b7b7021e68f1fa6e1d6271`
- candidate: `0.7.0-dev.36719340135.1`
- parent exact-head CI: 14/14 SUCCESS
- full Browser regression: 3723/3723 PASS

Successor branch:

`work/client-v1-admin-connectivity-v1`

## Finding 1 — “Data offline” is not the Native control-plane status

The R84/R97 top bar used:

`useMe2((s) => s.connected)`

That value is driven by the legacy ME2 bus:

- Socket.IO: `/?XTransformPort=3040`
- REST fallback: `?XTransformPort=3041`

Therefore `Data offline` only meant that the legacy daemon feed was unavailable. It did not establish any of:

- Native Browser runtime failure;
- device enrollment failure;
- Supabase Edge failure;
- ADMIN grant failure;
- signed heartbeat failure;
- DevOS/Fleet failure.

The product badge was therefore a false authority projection.

Decision: the primary top bar must show a typed Native Supervisor connection readback instead. Legacy daemon connectivity remains diagnostic-only.

## Finding 2 — the Client already has the correct device-key primitive

`SupervisorDeviceIdentity` already:

1. generates a local P-256 keypair;
2. fingerprints the public JWK;
3. encrypts the private key with Electron `safeStorage`;
4. persists only the encrypted private-key blob;
5. decrypts it only in the Browser main process;
6. signs every device request with:
   - profile;
   - device id;
   - HTTP method/path;
   - timestamp;
   - nonce;
   - body SHA-256;
7. deliberately removes `encrypted_private_key_b64` from public snapshots.

This is a stronger client credential boundary than embedding one shared service/admin token in every installer.

Decision: administrative authority is attached to the exact device key, not to a global secret inside the EXE.

## Finding 3 — existing Native devices were privileged but ADMIN was implicit

Approved Native Browser devices already authenticated the same privileged routes used for:

- supervisor control;
- DevOS;
- fleet;
- recovery/diagnostics;
- update;
- roadmap/meta control.

The device table did not explicitly record this authority tier.

Decision: record a revocable `ADMIN` grant on the exact enrolled device:

- `access_tier=ADMIN`;
- bounded `admin_scopes`;
- monotonic `admin_grant_epoch`;
- independent `admin_revoked_at`.

This formalizes existing authority rather than placing a new master credential in the client.

## Finding 4 — the current Edge query path can consume scarce Postgres sessions

The Native Supervisor Edge used `postgres(DB_URL,{max:2,...})` for normal:

- enrollment;
- device authentication;
- nonce validation RPC;
- heartbeat state writes;
- command lease/complete RPCs;
- status reads.

Recent live diagnostics returned PostgreSQL `53300` (connection slots exhausted).

This means an HTTP-reachable Edge can still become unavailable because each Edge isolate's normal control requests depend on direct Postgres query sessions.

Decision: move normal control-plane reads/writes/RPC calls to the Supabase Data API/PostgREST and keep direct Postgres only for operations that need it:

- explicit DB-inspect diagnostics;
- dedicated LISTEN/NOTIFY wake session.

## External Supabase research

### Serverless drivers

Supabase documentation says the REST API used by `supabase-js` has a built-in connection pooler and is suited to serverless workloads with high concurrency.

Source:
https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers

Relevant consequence for METAENGINE:

- normal Edge requests should use HTTP Data API / RPC;
- a held Postgres connection is not required for enrollment, auth, heartbeat or command RPCs.

### Edge database integration

Supabase recommends `supabase-js` for most Edge Function database access and documents direct Postgres as an available specialized alternative.

Source:
https://supabase.com/docs/guides/functions/connect-to-postgres

METAENGINE keeps raw Postgres only where HTTP RPC cannot replace the semantics (LISTEN/NOTIFY and explicit DB inspection).

### Secret/service-role keys

Supabase explicitly states that secret/service-role keys must never be exposed in frontend/client software and may be used in backend Edge Functions.

Sources:

https://supabase.com/docs/guides/database/secure-data
https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
https://supabase.com/docs/guides/functions/secrets

Modern `sb_secret_*` keys are not JWTs. Supabase documents sending them on the `apikey` header rather than `Authorization: Bearer`.

Decision:

- Client EXE receives no service-role or Cloudflare master token.
- Edge reads server secrets from Edge environment.
- PostgREST calls send the server key via `apikey`.
- `Authorization: Bearer` is emitted only for legacy JWT-shaped service-role keys.

## Finding 5 — absolute network availability cannot be a truthful invariant

A desktop application cannot prove or guarantee that:

- the user's Internet connection is available;
- DNS/TLS is available;
- Supabase is healthy;
- a regional/provider outage cannot occur.

A useful “guaranteed connection” contract therefore means:

1. local Browser shell starts independently of cloud;
2. device key is durable/protected;
3. an enrolled device reconnects automatically;
4. ADMIN authorization is independently read back;
5. transient cloud failures use the existing supervisor backoff/watchdog;
6. command/effect retries are never fabricated from an unknown result;
7. fallback sentinel can switch to a configured local reserve without a second authority plane;
8. UI states distinguish local readiness from cloud/Admin readiness.

The explicit projection includes:

`network_availability_guaranteed=false`

so UI/release evidence cannot silently turn this reliability contract into an impossible uptime claim.

## Implementation decision

### Server

Migration:
`20260930163000_client_v1_admin_connectivity_v1.sql`

Adds:

- device ADMIN grant fields;
- exact ADMIN readback RPC;
- server-side shallow supervisor-state merge RPC.

Native Supervisor Edge:

- normal data/RPC path → PostgREST;
- direct Postgres query pool removed from normal request handling;
- dedicated Postgres LISTEN/NOTIFY session retained;
- DB-inspect retains explicit raw SQL access;
- every signed privileged route requires the exact ADMIN device grant;
- `GET /v1/admin/status` returns a secret-free exact readback.

### Client

Native Supervisor:

- refreshes ADMIN readback in its existing cycle;
- no second reconnect scheduler;
- exposes typed `metaengine.client.connection-status.v1`;
- automatically reconnects through the existing supervisor backoff/watchdog;
- never retries a Browser/task effect merely because connectivity is ambiguous.

### UI

Primary top bar no longer uses the Socket.IO daemon feed as connection authority.

It shows:

- `Admin connected`;
- `Admin reconnecting`;
- `Enrollment`;
- `Starting`.

Legacy daemon feed remains usable by retained diagnostic/advanced pages but is explicitly non-authoritative for Client connection state.

## Fresh-install trust boundary

A brand-new, never-approved machine cannot safely mint itself an ADMIN grant merely by generating a new key. That would make arbitrary downloaded copies self-authorizing administrators.

The secure invariant is:

- existing approved installations/upgrades keep their DPAPI-protected device identity and require no manual token entry;
- new devices require the existing enrollment approval/bootstrap trust event once;
- after enrollment, connection and ADMIN reauthorization are automatic and revocable.

A future zero-touch *new machine* flow must bind enrollment to a separate trusted installation/owner attestation; it must not be implemented by embedding a reusable master secret.


## Installed Electron qualification trust

The Windows installed-runtime gate initially exposed a useful distinction:

- the installed Browser reached `NATIVE_SUPERVISOR READY`;
- UI, packaged daemon and clean-genesis control were healthy;
- the runtime remained `WAITING_FOR_ENROLLMENT`;
- therefore `ADMIN_CONNECTED` could not honestly be claimed on a fresh GitHub-hosted machine.

The qualification path now uses a separate backend-only GitHub Actions OIDC gate:

`metaengine-client-installed-qualification-h205f22`

It verifies:

- GitHub OIDC issuer and dedicated audience;
- exact repository/repository ID/owner ID;
- pull-request subject;
- exact installed-qualification workflow path;
- GitHub-hosted runner;
- run ID + attempt;
- live GitHub Actions run metadata;
- exact run head SHA.

Approval is additionally bound to a random 256-bit per-run correlation value. Only its SHA-256 is inherited by the installed Browser and stored in enrollment metadata. The SQL approval RPC requires the exact tuple:

`run_id + run_attempt + source_head + qualification_nonce_sha256`

and exactly one fresh matching `INSTALLED_ELECTRON` enrollment request.

The GitHub OIDC minting environment is cleared before Electron starts. The OIDC JWT itself exists only in the workflow PowerShell process and is never passed to the Browser. The qualification hash has no independent authority and cannot approve anything without the separately verified GitHub OIDC identity.

This gate is deliberately isolated from normal production enrollment. It exists to produce physical installed-runtime evidence, not to make arbitrary freshly downloaded Browser copies self-authorizing administrators.
