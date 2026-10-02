# Guardian semantic hardening qualification — 2026-10-02

Qualified source: `bf21d71b6dc674c376bd396487b5efc134d0a3e9`  
Runtime branch: `work/guardian-status-semantic-hardening-v1` · draft PR #1090  
Stacked base: PR #1089 exact `1f6902daeae8bc201d1c493e8a413f320a80aeec`

All 10 triggered exact-head workflows completed SUCCESS.

Critical Audit full Browser Node suite:
- tests 3859
- pass 3859
- fail 0
- skipped 0

Qualified Package Smoke #3127:
- run id `36966356240`, attempt 1
- package `0.7.0-dev.36965253139.1`
- installer bytes `159810808`
- installer SHA-256 `d59ca94853ac7f7749d84a526849f369137ca34698e7987a5f7fd6a03d79262a`
- blockmap SHA-256 `036ec3714b50bfc3321f1a89ee6431dbdd0b69da29eb4067afdb148ce2b8d884`
- config SHA-256 `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`
- provenance id `f50ef06d-ee09-4f20-9fe7-86ce7fe933cf`
- candidate artifact 11209524202, archive SHA-256 `98a7ab28d5faeb1e5e15447813358e3e2642909d4efc8177db06f62819341435`
- evidence artifact 11210347430, archive SHA-256 `d30cbc867898bed9f50b080bf00c2dbe94ca442006c944a5cf2a53aa237ecb8b`

Package physical checks passed: normal primary UI boot, second-instance activation, 190-second startup-grace survival, stable Browser/Sentinel continuity, installed ME2 UI/daemon proof, and Guardian machine-bootstrap qualification.

Autonomous Soak #2672 consumed the same producer artifact:
- 72/72 second-instance activations
- p95 activation latency 643.57 ms, budget 1000 ms
- working-set growth 0
- handle growth +9, budget +24
- duplicate Browser runtime false
- 1M semantic edges / 128 cells / 128 agents
- 127357 semantic edges/s
- 32 peak mutation lanes
- 100k continuous Brain PASS
- 2000 tasks / 2048 peers PASS
- all configured chaos seeds PASS

Self Update #3591 consumed the same producer artifact and completed SUCCESS:
- fast baseline `0.7.0-dev.36806234662.1` -> target `0.7.0-dev.36965253139.1` PASS
- resident legacy `0.7.0-dev.34759310781.1`
- legacy Browser/Sentinel gone
- target Browser/Sentinel started
- installer exit 0
- planned shutdown verified
- retry dialog false
- installed executable SHA-256 `e3b2e0c306170e0ab6da2d1ec5defc314d0e63f330348d9b7b25e38505878a32`
- self-update evidence artifact 11209687376, archive SHA-256 `4814bd8916bb685130036d5772cdbe12e19c1bc4f0cf7e8c9838d0fc03349595`

Qualified semantic changes:
- stale current service/owner/device proof is scrubbed to false;
- prior positive proof is exposed only as explicitly historical `last_confirmed_*` data;
- activation invalidation clears current cached proof;
- READY requires service + owner + device proof;
- contradictory non-READY positive proof is rejected;
- process-local observation revision and old-generation fence remain intact;
- Edge/canary source remains unchanged;
- Guardian heartbeat remains diagnostic-only.

No production promotion, live install, live owner mutation, or admission change is authorized by this checkpoint.

A separate analysis found one remaining freshness edge: wall-clock rollback can extend a Date.now()-based TTL. That issue is isolated in `analysis/guardian-freshness-clock-bf21d71b` and must use a new package identity if implemented.
