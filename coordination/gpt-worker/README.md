# GPT Coordination Worker — H205F22 — QUARANTINED

Historical PREPARED-only ChatGPT-side coordination worker for PAP.

This component is now **reference-only**. It is not part of the canonical METAENGINE production agent path and must not be deployed by the repository workflow. Canonical agent execution is owned by METAENGINE Browser through the authenticated **z.ai Agent Web UI**, with Browser-owned session provenance, typed semantic effects, and durable readback.

## Historical behavior

The retained source documents the former Cloudflare Durable Object design:

- one named object persisted a peer sequence cursor and guard counters;
- PAP messages requiring a response were sent to the OpenAI Responses API;
- deterministic guards enforced authority-plane separation, evidence honesty, transition contracts, and secret scanning;
- every outgoing envelope was PREPARED-only with `canonical=false` and `authority_effect=false`.

The source remains for regression/reference analysis while the Browser/Web-UI path converges. Its existence does not grant production authority and must not be interpreted as an alternate agent runtime.

## Quarantine boundary

The committed GitHub workflow is validation-only:

- it parses the historical modules;
- it runs deterministic guard and quarantine tests;
- it may run a Wrangler **dry-run** bundle check;
- it has no deployment job;
- it binds no model API or worker-control secrets;
- it performs no PAP mutation or model inference.

Do not add a deployment job, secret installation, scheduled production trigger, or Browser/runtime dependency back to this component. Any future extraction or deletion should preserve useful deterministic guard tests without restoring a second model-execution plane.

## Historical non-authority contract

The retained implementation hard-coded:

- `evidence_class=PREPARED`
- `canonical=false`
- `authority_effect=false`

It had no DB service-role credential and did not infer project claim liveness. Project claim authority, execution leases, transport identity, and Browser Agent authority remain separate planes.

## Local deterministic validation

```bash
node --test test/guards.test.mjs
node --test test/quarantine.test.mjs
node --check src/guards.mjs
node --check src/index.mjs
```

The direct managed-model call in the historical source is retained only as reference material until its remaining guard consumers are extracted. It is not an approved METAENGINE production inference path.
