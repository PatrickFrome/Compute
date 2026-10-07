# Native device bootstrap recovery — 2026-10-07

The installed Client is still `be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c` / `0.7.0-dev.37493000001.1`.
The authoritative recovery branch was already at `8300ff4249546ec254fddc9866157a257ff0ab54` (#1139),
ahead of the supplied scratch checkout. This slice is based on that published head and preserves its
composer placeholder, actual insert accounting, independent advisory capture and idle mutation ownership fixes.

## Verified current frontier

- The five cognitive/issuer/claim-class forward migrations already exist in the selected live project.
- Stable Edge version 16 includes the client-scoped v30 forwarding path; v30 and rollback-v12 are preserved.
- Official Meta plan: ACTIVE, generation 9; first READ_ONLY task `8167889f-6d9e-482c-a1d1-6895c0a510c9` is READY with lease generation 0.
- Admission is OPEN at generation floor 28, resumed during the preceding recovery session.
- Four Fleet-owned agents remain BOUND_UNVERIFIED. Supervisor mesh is empty.
- Fresh PostgreSQL logs identify `devos_transport_promotion_active_holder_missing` as the blocking RPC fence.
  The Client's deadline projection sometimes masks this underlying rejection.
- Guardian reports fresh HOLD / EPERM on its Windows named pipe. No owner proof has been fabricated.

## Architectural change

An empty mesh no longer requires a conversation-bound supervisor to prepare the first agent conversation.
The approved native device can hold a **transport bootstrap** lease in the existing single client actuation lane.
This is not a new scheduler or a task lease. It neither invents a mesh identity nor sets an agent ACTIVE.
The existing Client must still prove the isolated conversation and its seed send, then acquire a task lease through DevOS.

The service-only RPC verifies active enrolled ADMIN device + FLEET/DEVOS scopes, grant epoch, signature-authenticated
device identity supplied by Edge, fresh CONTROL/armed Client, OPEN runtime authority, exact Fleet-owned
BOUND_UNVERIFIED agent/tab/target/generation and absence of transport proof. Nonempty meshes use the original
conversation-owned lease path, including ambiguous mesh states. An exact durable lease binding fences duplicate
readback, device grant changes and target drift. Existing active actuators exclude bootstrap through the same lock/lane.

The restricted Edge route applies to client `2a60d6a2-c7c2-4dcc-b4c9-99de768443c9` only.
It verifies the existing P-256 signature + nonce before using the RPC. Caller body cannot choose a device or coordinator.
No request, ambiguous effect or unverified seed send is automatically replayed.

New SECURITY DEFINER is restricted to service_role because taking shared locks on protected device/admin rows must
not grant direct device mutation permissions to the caller. search_path is pg_catalog; relations are qualified;
PUBLIC/anon/authenticated execution is revoked. The new binding table has RLS and no public grants.

## Verification and rollback

- Local PGlite PostgreSQL engine: 36 cognitive + 14 issuer + 27 native bootstrap cases pass.
- Latest-source focused route/forwarder/idle/composer suite: 34/34 pass.
- Prior head `8300ff…` recovery CI, physical Windows Package Smoke and installed chat/soak workflows all succeeded.
  These are inherited predecessor evidence, not proof of the new source or the user's installed Client.
- New complete Browser mechanics on Linux and Windows and real PostgreSQL qualifications run at the new exact head.
- Original stable-v16 bundle is preserved under `coordination/client-v1/edge/rollback/stable-v16-20261007/` with hashes.
  Rollback restores that Edge bundle; the additive native RPC can remain unused. No live rollback drill is asserted yet.

Fresh package identity is `0.7.0-dev.37597000002.1`. Bootstrap predecessor `d71307ad…` consumed `0.7.0-dev.37597000001.1`; its PostgreSQL17.11 RPC qualifications passed, but shallow CI history omitted the pinned starvation regression subject. Full-history checkout repairs that setup failure without weakening the expected predecessor failure assertion. Earlier 37593000001.1 is consumed and is not rebuilt.
Do not claim trial completion until actual RUNNING → COMPLETED result, transcript/terminal evidence and independent
verification exist. The expected arithmetic result is 38; planner, researcher and critic nodes are dependency ordered.
Guardian Windows activation and actual executable coding sandbox remain separate unresolved frontiers.
