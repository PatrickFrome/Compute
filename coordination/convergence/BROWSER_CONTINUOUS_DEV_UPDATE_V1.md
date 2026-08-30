# BROWSER_CONTINUOUS_DEV_UPDATE_V1

Next slice after raw-byte/BOM recovery:

- keep update discovery single-flight;
- shorten packaged dev-channel discovery cadence without exceeding practical public GitHub API limits;
- expose next-check/check-in-flight telemetry;
- preserve explicit verified publisher selection and no downgrade;
- preserve quiescent restart grace, durable pre-install/successor receipts, singleton handoff and profile continuity;
- add persistent highest-seen trusted release state before widening release-controller authority.

Do not merge production authority or bypass physical N→N+1 evidence.
