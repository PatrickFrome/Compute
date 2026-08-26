# A2 Chat Bridge v0.5.23 — research decisions

- **Ordering:** strict GLM-first is a fail-closed transport invariant. GPT may start only after a fresh GLM command has reached durable `ACTUATED`, or A2 already proves GLM submitted the current blind peer wave.
- **Latency:** GLM need not finish first. After `ACTUATED`, GPT is released immediately so model generation remains parallel.
- **Actuation:** GLM uses only trusted `chrome.debugger` CDP mouse input; the content-script synthetic GLM send path is removed.
- **At-most-once:** `DISPATCHED` is persisted before mouse release; `ACTUATED` is persisted locally immediately after the trusted release and then acknowledged remotely. Ambiguous release failures never auto-retry.
- **Service-worker resilience:** transport state is durable in `chrome.storage.local`; in-memory trackers are only accelerators. Reconciliation can promote an ambiguous dispatch only from DOM evidence and can release a completed transport after worker restart.
- **Concurrency:** server command leasing is serialized in PostgreSQL with transaction advisory locking; predecessor consumption is transactional.
- **A2 freshness:** mailbox context reads the latest tail instead of silently freezing after the first 200 messages.
- **Privacy:** no response bodies, request URLs, prompt text, cookies, or credentials are sent as transport telemetry; correlation uses random 128-bit trace IDs.
