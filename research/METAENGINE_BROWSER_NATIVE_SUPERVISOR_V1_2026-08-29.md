# METAENGINE Browser Native Supervisor v1 — implementation checkpoint

Date: 2026-08-29

## Objective

Establish a real privileged control channel from the trusted METAENGINE supervisor plane to the installed Electron Browser. Opening ChatGPT inside the browser is not considered a control channel.

Target path:

`trusted supervisor -> Supabase command/control plane -> device-signed Electron main process -> typed browser actuation -> receipt`

## Implemented browser-side contract

Browser implementation branch: `work/metaengine-browser-native-supervisor-v1`.

The Electron main process now owns:

- persistent P-256 device identity;
- private-key protection through Electron `safeStorage` (Windows DPAPI-backed when available);
- approval-based enrollment with no reusable bearer secret copied into the browser;
- signed heartbeat and command lease polling;
- typed command receipts;
- live tab/fleet/Development Plane state;
- accessibility-based perception;
- on-demand page capture;
- typed navigation and semantic actuation through `webContents.debugger` / CDP.

Remote web pages retain zero access to the device key, supervisor transport, Node.js, raw CDP, or Electron main-process objects.

## Typed browser authority

Supported native supervisor actions include:

- `ARM`, `DISARM`, `SET_SUPERVISOR_MODE`, `SET_MODE`, `POLL`;
- `CAPTURE`, `CAPTURE_VIEW`;
- `NEW_TAB`, `SELECT_TAB`, `CLOSE_TAB`, `NAVIGATE`, `BACK`, `FORWARD`, `RELOAD`;
- `STOP_GENERATION`, `SCROLL`, `SEMANTIC_FOCUS`, `SEMANTIC_TYPE`, `TYPED_CLICK`;
- `FLEET_RECONCILE`, `FLEET_SET_PROFILE`;
- `DEV_PLANE_STATUS`, `DEV_PLANE_HEALTH`, `DEV_PLANE_CAPABILITIES`, `DEV_PLANE_PROCESS_METRICS`, `DEV_PLANE_REPO_HEAD`.

There is deliberately no arbitrary JavaScript evaluation, OS shell execution, arbitrary filesystem authority, direct source promotion, or page-originated authority.

## Enrollment security

Live Supabase project: `xpeibufgzjknrhbhpffp`.

Applied migrations:

- `a2_browser_native_supervisor_enrollment_v1`;
- `a2_browser_native_supervisor_actions_v1`;
- `a2_browser_native_supervisor_issue_rpc_v1`;
- `a2_browser_native_supervisor_enrollment_service_acl_v1`.

Enrollment lifecycle:

`PENDING -> APPROVED -> CLAIMED`

The browser proves possession of its local P-256 private key before creating or polling an enrollment request. Approval is bound to the exact client id, public JWK and SHA-256 fingerprint. Once approved, the server activates a device identity and all later requests use timestamped, nonce-protected device signatures. Browser roles have no direct access to the enrollment table.

## Live server deployment

Edge Function: `a2-browser-native-supervisor-v1`

Deployment id: `2599cb19-2c85-4292-838e-05e9d17e58da`

Version: `1`

Deployment digest: `6ce368cf0513791ecb68d146529d0e6014c0f35b33b08285da1bce4c0b5c52c1`

The function uses custom proof-of-possession/device-signature authentication, so the Supabase platform JWT gate is intentionally not the browser authentication mechanism.

## Command issuance gate

RPC: `h205f22_a2_browser_supervisor_issue_native_v1`

A supervisor command can be issued only to a client that:

- has an existing supervisor state;
- has a heartbeat fresher than 15 seconds;
- declares `client_kind=METAENGINE_BROWSER_ELECTRON_NATIVE`;
- receives an allowlisted typed action with bounded payload, platform and TTL.

A probe against a stale pre-native client correctly failed closed with `native_supervisor_client_stale`.

## Verification state

Static/contract verification on the native browser line: **58/58 tests PASS**.

The first Windows native-supervisor gate built the 0.6.0 installer but failed only in its post-build ASAR presence assertion because Windows `asar list` path separators did not match the slash-form test. The source parse/tests and installer construction itself passed. The gate has been patched to normalize ASAR paths and a replacement Windows run is active.

Physical remote-control acceptance remains intentionally **UNVERIFIED** until all of the following are observed on the user's installed browser:

1. the 0.6.0 upgrade is installed;
2. a fresh native enrollment request appears;
3. the exact fingerprint is approved from the trusted supervisor side;
4. signed heartbeats stay fresh;
5. `POLL` completes with a receipt;
6. `CAPTURE` returns current perception;
7. at least one benign typed actuation completes and its changed state is read back.

Only after those steps may `METAENGINE_BROWSER_NATIVE_SUPERVISOR_PHYSICAL_CONTROL` be marked VERIFIED.

## Real-time semantics

The browser publishes current control state continuously on its local polling cadence. The ChatGPT supervisor itself is turn-driven and does not execute indefinitely while no model turn is running. During an active supervisor turn, the latest heartbeat/state can be read and fresh capture/actuation commands can be issued repeatedly.
