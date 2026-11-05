# Inert delivery trace audit scaffold

This directory contains a **source-independent** reference oracle and unit tests for diagnosing producer → pending read → delivery reference → ACK traces. It is not integrated with METAENGINE and does not access systems or change authority.

Run (Node.js 20+):

```bash
node --test test/trace-oracle.test.mjs
```

`auditDeliveryTrace(events)` returns `{ok, issues, summary}`. It accepts plain, manually normalized event objects:

- `produced`: `message_id`, `producer_id`
- `pending_page`: `reader_id`, `cursor_in`, `cursor_out`, `has_more`
- `caught_up`: `reader_id`
- `delivery`: `message_id`, `delivery_ref`, `consumer_id`
- `ack_result`: `delivery_ref`, `outcome` (`ok`/`error`/`unknown`)
- `ack_readback`: `delivery_ref`, `durable` (from an upstream **verified** journal readback)
- `complete`: `delivery_ref`, `effect_key` (idempotency identity)
- `restart`: `consumer_id`

The model deliberately refuses to infer durable authority from `ack_result: ok`. `ack_readback` is an **assertion supplied by the trace adapter**; the oracle cannot authenticate it, and the `durable` boolean must NEVER be used to replace production authorization. `reader_id` identifies one pagination scan; a new full scan must use a new identifier. The model requires each scan to reach `has_more: false` and continuity across restart; unresolved ambiguous ACKs appear in `summary.uncertain_refs` rather than becoming successes.

Test outcomes validate only the oracle's rules. They are **not PASS results for c265/e30**. See [AUDIT.md](AUDIT.md) for source identity, blockers, and actual test status.
