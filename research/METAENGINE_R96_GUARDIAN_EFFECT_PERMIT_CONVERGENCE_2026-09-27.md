# METAENGINE R96 — Guardian process-effect permit convergence

Date: 2026-09-27  
Release/UI convergence base: `84306803b8cd58f81ca8371b25fd7f5cbebfa0f4`  
DevOS authority source: `b69f6629ddc696daf19c122f8c0a3e7a9be44f63` on `integration/metaengine-development-os-v1`  
Scope: process-effect safety convergence only. No production promotion or new authority.

## Lineage audit

The release/UI lineage and the DevOS integration line share merge base
`c32b62cc6ad48c52765a0a4fe0f2eef0f30c53ab`. The DevOS line has exactly four
unique commits after that point. Split-heartbeat health admission is already byte-identical
on the release line. The remaining unique safety semantics are:

- durable process-effect admission bound to exact plan/release/process identity;
- one-shot dispatch permit minted only after the matching `EFFECT_ATTEMPTED` durable barrier;
- START_CHILD executor validation of the exact permit immediately before the physical adapter call.

This branch selectively restores those semantics rather than merging 1600+ divergent commits.

## Why the extra permit matters

The current release executor already has a durable journal and a no-replay rule after
`EFFECT_ATTEMPTED` / `AMBIGUOUS`. The missing permit is therefore defense in depth,
not evidence that duplicate effects have occurred.

The extra boundary closes a narrower crash/drift window: a stale or mismatched plan,
generation, target release, or process identity must not be able to reuse a previously
admitted effect attempt. The adapter receives a proof object tied to the same exact
journal generation that crossed the durable barrier.

## External systems research

### AWS Builders' Library — Making retries safe with idempotent APIs
https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/

Timeouts can leave the caller unsure whether an effect occurred. AWS recommends a
caller-supplied unique request identity and rejecting parameter drift instead of blindly
repeating singleton effects.

### Stripe — Idempotent requests
https://docs.stripe.com/api/idempotent_requests

Stripe binds retries to an idempotency key and compares incoming parameters with the
original request, rejecting mismatched reuse.

### Google Cloud Spanner — unknown commit status
https://cloud.google.com/spanner/docs/error-codes

An unknown commit outcome must not be treated as a normal retryable failure because a
second business operation may duplicate an already-committed effect.

### Temporal — durable execution
https://docs.temporal.io/

Durable execution resumes from persisted workflow state after crashes. METAENGINE keeps
that principle but retains a stricter one-shot process-effect barrier: recovery reconciles
an ambiguous generation rather than replaying it.

## Implementation

- canonical admission and dispatch-permit modules are copied byte-for-byte from
  `b69f6629ddc696daf19c122f8c0a3e7a9be44f63`;
- their focused tests are copied byte-for-byte;
- the modern release executor is minimally patched instead of replaced wholesale;
- exact admission is checked after durable intent;
- exact permit is checked after `markEffectAttempted()` and before `dispatchStart()`;
- the adapter receives `dispatch_permit`;
- every result remains `automatic_retry_allowed=false` and zero-authority.

## Acceptance

This branch is not qualified until the full exact-head Browser workflow matrix is terminal
green. Any ambiguity or CI mismatch keeps the branch draft and blocks convergence.
