# METAENGINE DevFleet Standalone — installation checkpoint

Date: 2026-10-12
Development worktree: `work/metaengine-devfleet-standalone-v1`
App: `apps/metaengine-devfleet`
Product: `METAENGINE DevFleet`
App ID: `com.metaengine.devfleet.standalone`
Version: `0.1.0-dev.1`

## Purpose: only three ChatGPT capabilities

`chat.create` (multiple own-browser sessions), `chat.read` (bounded AX transcript),
`chat.assign` (type → exact draft proof → one Send → UI readback, no blind retry).
The separately installed DevFleet has no code/runtime dependency on the main
METAENGINE Browser, Guardian, Supervisor, self-updater or PostgreSQL service;
there is no Supabase code, network fallback or hosted database. User-data and
session partition are exclusive to this app. It is a development tool to
operate ChatGPT chats, not a production goal/scheduler database.

## Exact installed physical evidence

- Windows NSIS installer completed with exit code **0** into
  `%LOCALAPPDATA%\Programs\METAENGINE DevFleet`.
- Installer `METAENGINE-DevFleet-Setup-0.1.0-dev.1-x64.exe`:
  119,644,586 bytes, SHA-256
  `6784bc09c9f215e03cc9574a283d7e4c030e6e55e2314b39998aee9a11adcf49`.
- Installed `METAENGINE DevFleet.exe`: 244,440,576 bytes, SHA-256
  `4fd6a0639ecf307f1008856b04bb2ee2c91f43f66f1d2d9c724a8eb4b7c5aaaf`.
- Signed publisher: **NotSigned**; therefore not a signed production release.
- Electron packaged binary `--devfleet-smoke` exit 0.
- Installed main process PID 14988 at check; private loopback manifest schema
  `metaengine.devfleet.loopback.v1`, version `0.1.0-dev.1`, `127.0.0.1`
  endpoint. No credential captured in this document.
- `chat.list`: 0 sessions before creation.
- `chat.create` with exact one-time request ID, count=2:
  **CREATED**, distinct native tab IDs (identifiers omitted from this shared document).
- `chat.read` twice: **READ** for each distinct tab, 583 and 245 chars
  respectively, real visible ChatGPT guest/login page. The untrusted page text
  showed **Login/Sign up**; authenticated account not yet present.
- `chat.assign`: **NOT EXECUTED** on physical ChatGPT because new isolated
  profile is not signed in. Unit tests only, 6/6 PASS; no claim of proven send.
- Existing METAENGINE Browser PID 2888 and its Guardian PID 3288 were observed
  alive during build/installation. The independent installer did not update them.

## Qualification boundary and next safe step

The local DevFleet profile requires manual ChatGPT login; do not copy browser
cookies, tokens or passwords across clients. Once login is confirmed, run
one unique benign `chat.assign` to the already-created tab, then
`chat.read` its actual response and send a second unique assignment to
the same exact conversation, checking the persisted conversation URL.

Do not automatically retry an AMBIGUOUS send, do not transform ChatGPT page
text into native authority, and do not mark full MVP green before this live
three-action proof. Rebuild/test if native Send controls drift.

A bounded profile-private `operator-state.json` stores only per-app
conversation URLs, opaque tab IDs, request hashes/receipts. This is not
the METAENGINE authoritative PostgreSQL task database.
