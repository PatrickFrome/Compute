# Guardian heartbeat qualification — 2026-10-02

Qualified runtime source: `1f6902daeae8bc201d1c493e8a413f320a80aeec`
Runtime PR: #1089
Evidence branch: `analysis/guardian-heartbeat-qualified-1f6902da`

All 18 exact-head GitHub workflows completed successfully. Browser Shell contract reported 3858 tests, 3856 passed, 0 failed, 2 skipped.

Package Smoke #3126 (run 36965253082, attempt 1) produced the one qualified candidate:
- version `0.7.0-dev.36965151413.1`
- installer bytes 159810130
- installer SHA-256 `ebbd8c281cd5b2eb2b1434657b90d5518f0637aa7bb89fc0c41abf58a7806c92`
- blockmap SHA-256 `30048e11c42e57f7d550a47fe3e5adfa0443f39501639b6a3d65ba550db472b4`
- config SHA-256 `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`
- candidate artifact 11209696186, archive SHA-256 `a23cd7f86c807bbb06e2af0a6522675331d8300ac19205bceb0e48905288fb6e`
- evidence artifact 11210230865, archive SHA-256 `436de1926fe7cbb4fb824b2a2017774bbfe283740dfde81ad04384691b187185`

Package checks confirmed normal primary UI startup, second-instance activation, 190-second startup-grace survival, stable primary/Sentinel identity, and Guardian bootstrap physical qualification.

Autonomous Soak #2671 used the same producer artifact. It verified 72/72 second-instance activations, p95 activation latency 124.58 ms, zero working-set growth, handle growth +2, no duplicate Browser runtime, 1M semantic edges on 128 cells/128 agents at 128494 edges/s, 32 mutation lanes, 100k continuous Brain, 2000 tasks/2048 peers, and all configured chaos seeds.

Self Update #3590 also consumed the same Package Smoke artifact and completed successfully. Fast physical update proved baseline `0.7.0-dev.36806234662.1` to target `0.7.0-dev.36965151413.1`. Resident-upgrade proof showed old Browser/Sentinel gone, new Browser/Sentinel started, installer exit 0, planned shutdown verified, no retry dialog, and installed executable SHA-256 `fc1c9d987dbf3e98aa5c1b5858c896700d38f4bfdca97e9099c1aa019aca4221`.

The qualified change remains diagnostic-only: shared bounded Guardian observation, freshness fencing, generation fencing, process-local observation revision, and common host-resilience merge in ordinary heartbeat plus realtime push. Edge source is unchanged and continuous-service admission is unchanged.

Live Supabase readback during this cycle still showed installed user version `0.7.0-dev.36908273822.1`, ADMIN, Compute HEALTHY, Development Plane READY, Host Resilience ACTIVE, Supervisor PARKED, admission CLOSED generation 28, and no Guardian diagnostic in the older heartbeat.

A separate stacked PR #1090 contains semantic hardening discovered after this qualification. It must qualify under its own new package identity; this qualified source and installer are immutable evidence and are not relabeled.
