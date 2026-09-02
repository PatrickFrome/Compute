# Browser Final Optimization V1

Exact base: `0f14416d2a9de3a69171df8e08ed22c663f65ea6` (`work/browser-workspace-reincarnation-v1`).

This slice changes no scheduler, Browser authority, lease semantics, production database, updater authority or release channel.

Optimization:
- Workspace projection already uses indexed `tabMap` and `agentMap`, keeping binding admission linear rather than repeated tab/agent scans.
- READY/FROZEN/RESERVED counters are now accumulated during the authoritative binding pass instead of allocating and scanning `groups` three additional times on every shell snapshot.
- Sessions remain a separate exact tab-id pass; deterministic branch/group ordering is preserved.
- `structuredClone` isolation remains intact; no authority-bearing input is memoized across snapshots.

Safety invariants preserved:
- durable Workspace Binding is the only grouping authority;
- URL/title heuristics remain disabled;
- stale lease/target/agent generation remains fail-closed;
- automatic retry remains disabled;
- renderer/browser actuation authority remains false;
- no second scheduler or polling loop is introduced.

Acceptance requires the dedicated Typed Workspaces gate, full Browser Shell gate, Windows package smoke and physical N->N+1 self-update on one exact final SHA before distributing the installer.
