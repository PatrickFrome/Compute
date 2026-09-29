# C2.1 Checkpoint — Exact R109 Edge Canary Pin

Captured: 2026-09-29
R109 baseline: ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551
Supabase project: xpeibufgzjknrhbhpffp
Canary: a2-browser-native-supervisor-v14-canary

## Before

- version: 1
- digest: b88e59e8be31f6f0a4c3d58605bad5753d45acf04e9c5a65fe7c8f28e02c9be3
- immutable import pin: ef04d60a63c260cfaf7fe530b0026f03ea2401c4
- import pin occurrences: 10

The deployed canary wrapper normalized to the repository entrypoint exactly after accounting for the canary-specific SERVICE_MARKER.

The repository entrypoint blob is unchanged between ef04d60a... and R109; the R109 Edge drift is in imported source, specifically devos-routes.mjs plus the Agent-origin DB migration.

## Implemented

Re-deployed only the isolated v14 canary.
All ten immutable GitHub import pins now point to exact R109:

ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551

Production a2-browser-native-supervisor-v1 was not changed.

## After readback

- status: ACTIVE
- version: 2
- digest: 780b6537584d96edc754bf389956e9c405a6713a823b6f9ef7995e954c116911
- unique remote import pins: [ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551]
- pin count: 10/10 exact
- canary SERVICE_MARKER preserved

## Remaining C2 barrier

Postgres readback is unavailable with ECONNREFUSED.
Therefore the Agent-origin migration has NOT been applied or claimed present from this session, and R83/C2 are NOT considered complete.

Required next safe step:
1. regain DB readback;
2. inspect migration state;
3. apply exact 20260928034500_devos_agent_origin_receipt_v1 only if absent;
4. verify function definition/readback;
5. run security/performance advisors;
6. update R83 evidence with v14 canary version 2 + digest;
7. rerun exact qualification.

## Research note

Supabase documents the platform as stateful and recommends controlled migration workflows; production rollback can lose intervening data. This reinforces the fail-closed decision not to issue a DB mutation while migration/readback connectivity is unavailable.

Status: C2.1 IMPLEMENTED + VERIFIED.
C2 overall: BLOCKED_DB_READBACK.
