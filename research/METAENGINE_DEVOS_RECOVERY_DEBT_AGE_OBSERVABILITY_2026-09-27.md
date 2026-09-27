# METAENGINE DevOS — recovery-debt age observability

Date: 2026-09-27  
Base: authoritative DevOS `b69f6629ddc696daf19c122f8c0a3e7a9be44f63`  
Scope: read-only observability. No scheduler or recovery policy change.

## Live finding

The current durable fleet is behaving fail-closed: expired leased work becomes `AMBIGUOUS`,
`automatic_retry_allowed=false`, and newer semantic points are distinct tasks rather than blind
replays. The scheduler already has a recovery-aware frontier budget, so adding another scheduler
or retry loop would be a regression.

The missing signal is **time**. A raw ambiguous count cannot distinguish an old stable backlog
from a currently growing transport failure. Current production evidence shows repeated
`LEASE_EXPIRED_EFFECT_UNKNOWN` generations, so operators need oldest-age plus recent-arrival
windows before changing capacity policy.

## Research

### Amazon SQS / CloudWatch

AWS exposes both queue depth and `ApproximateAgeOfOldestMessage`; its alarm guidance recommends
using oldest age together with queue count because age detects consumers that are not processing
at the desired speed.

### Kubernetes workqueue metrics

Kubernetes exports queue duration, longest-running processor, retries and unfinished-work seconds.
The combination is specifically useful for detecting stuck processing rather than inferring it
from queue depth alone.

### Temporal Worker performance

Temporal surfaces Task Queue backlog counts, task rates, worker heartbeats and available task
slots together. Capacity and backlog health are observed separately before tuning worker
concurrency.

### Ray

Ray reports explicit backpressure and pending/active/failed resource state. The autoscaler
reconciles from a current snapshot; it does not become the task scheduler.

## METAENGINE decision

Add a **read-only supplement**, not a second policy plane:
- exact unresolved effect-unknown count;
- unresolved unknown arrivals in 15m and 60m windows;
- oldest unresolved unknown age;
- exact task+lease-generation transport-proof classification;
- no task content and no retry/scheduler/browser/release authority.

This evidence can later support a separate, reviewed capacity-policy change if sustained debt
growth is proven. This branch deliberately does not change `new_frontier_slots` or recover any
ambiguous task.
