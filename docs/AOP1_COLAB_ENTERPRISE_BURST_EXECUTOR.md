# AOP1 Colab Enterprise burst executor contract

Decision: `EXPERIMENT / AUXILIARY_COMPUTE_ONLY`

Ordinary hosted Colab is not eligible for AOP1 critical-path execution because it is interactive and subject to dynamic runtime limits and termination. Colab Enterprise is eligible for experimentation because notebook executions are machine-addressable through Vertex AI `NotebookService` / `notebookExecutionJobs`, can use a runtime template and service account, and can persist output to Cloud Storage.

## Authority boundary

A Colab execution is compute, not control-plane authority.

It MUST NOT receive:

- H205F22 supervisor token;
- Supabase service-role key;
- Cloudflare deployment token;
- unrestricted GitHub write credentials;
- permission to mark roadmap milestones VERIFIED or reserve/seal checkpoints.

Its only admissible output is evidence/result material that AOP1 can independently hash, validate and ingest before any authoritative transition.

## Proposed transport

```text
AOP leased run
  -> immutable burst job envelope
  -> GitHub repository_dispatch / dedicated dispatcher
  -> GitHub Actions OIDC
  -> Google Workload Identity Federation
  -> Colab Enterprise notebookExecutionJob
  -> dedicated runtime template + service account
  -> result artifacts in GCS
  -> result manifest/hash callback to AOP
  -> AOP validates run_id + lease_generation + hashes
  -> wake WAITING_EVENT run
  -> normal Analyst/Supervisor pipeline
```

GitHub Actions OIDC is preferred over storing a Google service-account private key. Initial Google Cloud IAM / Workload Identity configuration is an external authority bootstrap analogous to the Cloudflare capability bootstrap.

## Burst job envelope

Every dispatch must bind at least:

```json
{
  "schema": "metaengine.compute.aop-burst-job.h205f22.v1",
  "job_id": "uuid",
  "aop_run_id": "uuid",
  "lease_generation": 1,
  "semantic_checkpoint_id": "...",
  "semantic_payload_root_sha256": "64-hex",
  "executor": "COLAB_ENTERPRISE",
  "notebook_sha256": "64-hex",
  "input_manifest_sha256": "64-hex",
  "toolchain_contract_sha256": "64-hex-or-null",
  "runtime_template_resource": "projects/.../locations/.../notebookRuntimeTemplates/...",
  "gcs_notebook_uri": "gs://.../executor.ipynb",
  "gcs_output_prefix": "gs://.../jobs/<job_id>/",
  "deadline": "RFC3339",
  "canonical": false,
  "authority_effect": false
}
```

The dispatcher must reject a stale `lease_generation`, semantic-head mismatch where strict head parity is required, unknown notebook hash, unknown runtime template, or output prefix outside the dedicated bucket namespace.

## Colab Enterprise execution

Supported machine execution can use the Vertex AI API or the equivalent current CLI shape:

```text
gcloud colab executions create
  --display-name=<job-id>
  --notebook-runtime-template=<template>
  --gcs-notebook-uri=<immutable notebook URI>
  --gcs-output-uri=<job output prefix>
  --service-account=<dedicated executor service account>
  --region=<region>
```

The runtime template determines VM/accelerator/network properties. The execution service account should have only notebook execution and bucket-scoped input/output permissions required for the job.

## Result manifest

The notebook writes a machine-readable result manifest beside its output:

```json
{
  "schema": "metaengine.compute.aop-burst-result.h205f22.v1",
  "job_id": "uuid",
  "aop_run_id": "uuid",
  "lease_generation": 1,
  "status": "SUCCEEDED",
  "started_at": "RFC3339",
  "finished_at": "RFC3339",
  "input_manifest_sha256": "64-hex",
  "notebook_sha256": "64-hex",
  "result_sha256": "64-hex",
  "artifacts": [
    {"uri": "gs://...", "sha256": "64-hex"}
  ],
  "claims": {
    "live_execution": true,
    "roadmap_verified": false,
    "authority_effect": false
  }
}
```

AOP must independently read back/hash result artifacts before accepting them as evidence. A notebook's self-reported hash or `SUCCEEDED` state alone is insufficient.

## Good uses

- large test matrices;
- compiler/build benchmarks that do not need a persistent worker identity;
- GPU-heavy synthetic benchmarks;
- large differential/replay analysis;
- artifact hashing or corpus transforms;
- independent research/verification jobs.

## Not valid for

- proving W1 persistent-worker safety unless the Colab runtime itself satisfies and is admitted under the W1 identity/safety contract;
- checkpoint sealing;
- direct mainline mutation;
- federation-provider authority;
- replacing T1 hermetic parity evidence without exact toolchain/runtime identity binding.

## Activation gate

Do not implement this as a live executor until:

1. Cloudflare AOP1 itself is live and has passed an end-to-end wake/workflow canary.
2. A dedicated GCP project/service account/runtime template/output bucket exists.
3. GitHub-to-GCP Workload Identity Federation is configured.
4. Burst job and result schemas have negative tests for stale generation, replay, altered manifest, altered artifact and wrong output bucket.
5. The first Colab run is classified `EXPERIMENTAL_LIVE_BURST`, not production worker proof.

## Current state

`CONTRACT_READY / NO_GCP_CONNECTOR / NOT_LIVE`
