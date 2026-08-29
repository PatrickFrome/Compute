# METAENGINE A2 Edge ingress

Production acceptance surface for `A2_REALTIME_MULTI_AGENT_COGNITIVE_BUS`.

- deployed Supabase Edge Function: `metaengine-a2-ingress-h205f22`
- source parity target: Edge version 3, EZBR SHA-256 `2a50178bc2f8c4751174f4a83e5ec410acfb26cc6b9dd4be1a47d070a4f10cf2`
- peer authentication: short-lived scoped bearer capability; only SHA-256 is persisted
- signature boundary: WebCrypto Ed25519 on the Edge, then DB-internal signature-bound HMAC receipt
- Vault HMAC secret never leaves Postgres
- model peers receive no database URL, service-role credential, or Vault secret
- conflict reconciliation is DB-resident and runs after signed action events plus snapshot/stream polling
- all A2 records remain `canonical=false`, `authority_effect=false`

The live acceptance workflow must prove tampered-signature rejection, valid-signature persisted verification, exact `openai/gpt-5.6-sol` + `zai/glm-5.3` lockstep, peer visibility, and durable replay before this surface is considered ready.
