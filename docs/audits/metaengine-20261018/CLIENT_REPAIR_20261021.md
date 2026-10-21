# Local client repair, 21 October 2026

Base: `56a745dcc4c38ac072b25740c43530931e1ee1c0`. Candidate version: `0.7.0-dev.1107139874587.1`. The build receipt must bind the final committed source; this document is not installed-runtime evidence.

Implemented:

- Complete the explicit unsigned QA Owner upgrade after exact installed-image, offline-runtime, native NSIS effects and unchanged Keeper readback. Preserve a private full predecessor image and registry/shortcut snapshot. Recovery is scoped to the fixed local Test installation, compares preimages and preserves unknown effects for manual readback.
- Refuse runtime bootstrap while the durable upgrade gate remains. A future Owner must not admit an incompletely installed image.
- Run the 72-activation resource soak inside the existing disposable attached-PostgreSQL Owner fixture, with fresh health, native-window and cleanup observations. Retain original latency, memory and handle budgets. Use planned shutdown instead of forced Browser termination.
- Retain sanitized qualifier progress and the first PID/boot-bound failure before cleanup. Give the outer fixture time for its already-existing bounded startup, activation and grace phases. Stop an activation wave when its P95 budget is mathematically impossible to meet.

Targeted source/behavior checks passed: 39 upgrade/consumer/image tests; 49 launch/progress/host/activation tests. Native NSIS codec rehearsal passed with exit 0; the private receipt records its exact script digest. YAML parses. No result here proves installed autonomy.

Current local read-only PostgreSQL inspection succeeded using the protected inspection identity. The old installed Browser remains fenced by its historical Owner/runtime digest mismatch until the explicit upgrade completes. No PostgreSQL lifecycle or historical task effect was changed by this audit.

Remaining acceptance: build the distinct candidate once; qualify staged runtime; execute and independently read back the physical upgrade; verify normal installed UI/API/Edge. The legacy SelfUpdate successor test still needs a genuine attached Owner, and hosted InstalledChat still reports quota 402. Neither is converted to a pass. Production signing/Owner custody and useful autonomous goal → lease → result → independent critic → PostgreSQL checkpoint → restart continuation remain separate, unproven gates.
