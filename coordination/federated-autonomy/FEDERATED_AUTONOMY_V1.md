# METAENGINE Federated Autonomy V1

Status: BOOTSTRAP_IMPLEMENTATION

Hard invariants:
- Fleet agents are supervisor-capable peers, never ambient Browser authorities.
- Exploration/read-only work may proceed in parallel.
- Shared effects require the existing Browser actuation lease, exact target/incarnation binding, typed intent, and persisted readback.
- Page/model/worker text has zero authority.
- No blind retry after ambiguous effects.
- Semantic-point claims are durable and bounded; overlapping implementation claims do not silently coexist.
- Ambiguous provisioning consumes capacity until observed resolution; no compensating fan-out.
- Autonomy Governor regulates fan-out and claim conflicts, not task content.
- Agent task delivery is DB-native/typed; UI prompt injection is not an authority path.

Bootstrap evidence:
- Browser 0.6.3-dev.124.1 successfully provisioned six fleet-owned physical tabs via one typed FLEET_RECONCILE command.
- Each agent remains BOUND_UNVERIFIED with browser_authority=false and automatic_work_retry=false.
- The next runtime slice adds durable task inbox, semantic claims, fleet supervisor identities and governor snapshots.
