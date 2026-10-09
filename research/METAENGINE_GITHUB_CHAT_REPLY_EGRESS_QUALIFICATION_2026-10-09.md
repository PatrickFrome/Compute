# METAENGINE GitHub-chat result egress qualification — 2026-10-09

## Threat model

The installed METAENGINE Browser's Host Agent, PostgreSQL, private config and Vault are a distinct authority domain from GitHub. A private GitHub issue is a network delivery channel and collaboration artifact, **not** a confidential transport for arbitrary local observations, process output, browser tab contents, file paths or credentials. A correctly configured private repository may still have more readers than the Windows owner and may retain posted comments or screenshot commits after a pairing is revoked.

The parent PR #1168/#1169 implemented device-bound GitHub message admission and a durable local journal but the GitHub reply path performed a broad `structuredClone(result)` followed by `JSON.stringify(result)` of arbitrary Host Agent results. Any lower API accidentally returning `database_url`, `authorization`, raw command stdout, user profile paths or an agent prompt could leak that value to a private issue.

## New source boundary

- `apps/metaengine-browser/src/github-chat-egress-policy.mjs` applies a bounded, deny-by-default projection to **every** outbound reply before the GitHub issue POST. Local PostgreSQL and journal retain the original result for reconciliation; the remote issue gets typed metadata only.
- Known secrets, authorization, credentials, cookies, connection strings, Vault, local PGDATA/file/screenshot paths, arbitrary stdout/stderr, raw payloads and environment blobs are always redacted by key. Arbitrary tab titles, page data, goal text, agent prompts and other unreviewed strings also redact by default.
- Only typed status, schema, IDs, digests, version, provider, reason and validated `metaengine-chat-artifacts/<relay UUID>/<request UUID>/<sha256>.png` repository paths can pass; output caps include recursion, object fields, array length and final bytes.
- A cyclic/unsupported/oversized object yields a fixed `RESULT_UNAVAILABLE` object. The relay never falls back to the unprojected result when validation fails.
- Screenshots remain a separately authorized feature: the requested PNG upload happens only through the existing per-pairing private-repository check, capture hash validation and cancellation check. On-screen private contents can still be visible **inside the screenshot** even when JSON metadata is redacted. Revocation prevents new uploads but cannot retract previously committed images. Future work: separate capture consent, retention, delete/disclosure policy.

## Verification and release gates

- Unit tests directly exercise nested secrets, embedded credentials, Windows/POSIX absolute paths, SQL connection URLs, GitHub PATs, tokenized HTTPS URLs, image artifact exceptions, overly large/deep/cyclic data and prototype pollution.
- GitHub relay E2E fixture tests verify that a STATUS reply actually posted to the issue contains typed counts/state but never its raw database URL, bearer authorization or Windows private-config path. Existing tests enforce exact command IDs, receipt, idempotency and screenshot artifact readback.
- Source parser checks include the reviewed new policy file. Physical Windows offline package, all Browser Node regression, dual-platform runtime contracts and exact-head immutable identity must pass.
- No user real PC, private PostgreSQL, Vault, private GitHub pairing or ChatGPT remote execution is exercised in public CI. No production promotion or long-lived unattended machine access without installed-device qualification and screenshot retention policy.
