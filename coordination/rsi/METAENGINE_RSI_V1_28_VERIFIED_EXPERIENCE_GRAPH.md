# METAENGINE RSI V1.28 — Verified Experience Graph Memory

Status: SOURCE IMPLEMENTED / PARALLEL RESEARCH LINE FROM GREEN V1.24 / CI PENDING / NO LIVE AUTHORITY

Exact base:

`work/metaengine-rsi-disagreement-acquisition-v1 @ 892f272d464816f23ae17702e5dfadc772d2553f`

Implementation branch:

`work/metaengine-rsi-experience-graph-v1`

This line is intentionally parallel to the V1.24–V1.27 skill-evolution work being developed concurrently. It is designed for later semantic convergence rather than blind stacked merging.

## Purpose

METAENGINE already has typed lessons, component attribution, verified group transfer, adaptive retrieval, hidden curriculum and archive search.

The missing memory primitive is **relational continuity**.

Flat collections answer:

> Which individual lesson looks relevant?

An experience graph can answer:

> Which failure was seen on this task, what later fixed it, which similar cases bridge to it, what evidence made the case useful in this exact target context, and what did the system know at a particular graph epoch?

V1.28 introduces an append-only, externally written experience graph for RSI evidence. It never becomes execution, scheduler, evaluation, promotion or self-update authority.

## Research mechanisms adopted

### EXG — task anchors, cases, similarity and correction edges

EXG organizes experience using:

- task-anchor nodes;
- case nodes for individual attempts;
- task containment edges;
- semantic similarity edges;
- correction / `fixed_by` edges linking failures to later successful attempts.

EXG retrieves from direct task history, semantically related neighborhoods and corrective traces, allowing successful fixes to be reused across later tasks.

METAENGINE adopts those exact structural ideas, but stores only bounded typed evidence. Raw trajectories, page text, user input and secrets do not enter the trusted graph.

Reference: Jin et al., *EXG: Self-Evolving Agents with Experience Graphs*, arXiv:2605.17721.

### ExpGraph — graph diffusion plus utility-aware retrieval

ExpGraph organizes skills/failure lessons in a self-evolving graph and combines graph diffusion with utility-aware ranking. Utility is learned from downstream outcomes rather than treated as static semantic similarity.

METAENGINE adopts:

- bounded similarity diffusion;
- target-context utility receipts;
- utility-aware ranking.

But contextual utility is never global truth. A case helpful for one target context does not become automatically portable to another.

Reference: Feng et al., *ExpGraph: Model-Agnostic Experience Learning with Graph-Structured Memory for LLM Agents*, arXiv:2605.30712.

### Trellis / Experience Graphs — durable queryable state

Experience Graphs: The Data Foundation for Self-Improving Agents argues that long-horizon agent search naturally produces a durable graph of artifacts, tool outputs, rewards, sibling comparisons and causal lineage. Treating this graph as database state enables recovery, cross-session reuse, horizontal scale, time-travel queries and later training-data materialization.

METAENGINE adopts the storage semantics at the source-contract level:

- snapshot digests;
- predecessor snapshot digest;
- monotonically increasing graph epoch;
- append-only extension;
- no in-place replacement of existing cases/edges/utility receipts;
- exact time-travel identity by snapshot digest.

V1.28 does not yet deploy a new production DB schema. The current slice defines the deterministic source contract that a later persistence layer must preserve.

Reference: Liao et al., *Experience Graphs: The Data Foundation for Self-Improving Agents*, arXiv:2606.29823.

### HyMEM / graph-structured computer-use memory

HyMEM reports that graph-based self-evolving memory can improve long-horizon computer-use agents by combining symbolic high-level structure with trajectory representations and multi-hop retrieval.

METAENGINE adopts only the graph-structured retrieval principle. It does not store raw computer-use trajectories in the RSI trust root and does not allow memory retrieval to actuate the Browser.

Reference: Zhu et al., *Hybrid Self-evolving Structured Memory for Computer-Use Agents*, Findings of ACL 2026.

## Trusted case representation

Schema:

`metaengine.rsi.experience-case.v1`

A case is exact-bound to:

- task id;
- task-signature digest;
- attempt index;
- candidate id/SHA;
- success/failure outcome;
- environment fingerprint;
- model family;
- execution-signature digest;
- bounded failure codes;
- bounded mechanism tags;
- optional lesson/attribution/transfer-receipt digests;
- exact evidence digest/refs.

Required safety state:

- external writer only;
- candidate-authored=false;
- raw trajectory absent;
- raw page text absent;
- raw user input absent;
- secret material absent;
- model narrative is not authority;
- source-context truth is not portable.

Unknown fields fail closed.

## Graph snapshot

Schema:

`metaengine.rsi.experience-graph-snapshot.v1`

The graph contains four relation/evidence families.

### Task containment

Every case must bind to one exact task anchor whose task-signature digest matches the case.

### Similarity

Similarity is externally indexed and represented only as:

- canonical case pair;
- bounded similarity score;
- embedding-model digest.

Similarity is explicitly a retrieval signal only.

### Correction / fixed_by

A correction edge may connect only:

`FAILURE attempt -> later SUCCESS attempt`

for the exact same task id and task-signature digest.

This prevents an LLM narrative from claiming that an unrelated success fixed a failure.

### Contextual utility

Utility is append-only external target-context evidence:

- HELPFUL
- HARMFUL
- NEUTRAL

Utility is keyed by exact target-context digest.

A successful source case therefore cannot accumulate universal reputation merely because it helped a different model/environment/task context.

## Append-only extension

`extendRsiExperienceGraphSnapshot()` accepts only additions.

Existing:

- task anchors;
- cases;
- similarity edges;
- correction edges;
- utility receipts

cannot be replaced under the same identity.

Every new snapshot increments the graph epoch and binds the exact predecessor snapshot digest.

This gives later persistence implementations a deterministic crash-recovery and time-travel contract.

## Retrieval

Schema:

`metaengine.rsi.experience-graph-retrieval.v1`

V1.28 combines four bounded retrieval signals:

1. exact task-anchor match;
2. externally supplied bridge cases from the current verified failure context;
3. at most two hops of similarity diffusion above a fixed similarity threshold;
4. verified correction-edge targets and contextual utility receipts.

The retrieval cap is fixed at 12 cases.

A `fixed_by` success receives stronger ranking priority than the failure bridge that led to it.

The candidate cannot choose:

- similarity threshold;
- diffusion depth;
- graph writes;
- case utility;
- portability state.

## Portability boundary

Retrieval is **not** transfer validation.

Every retrieved item remains:

`source_context_truth_is_portable=false`

and

`external_transfer_validation_required=true`

The intended composition with V1.14 is:

`experience graph retrieval -> transfer hypothesis -> external target-context validation -> verified portable memory`

not:

`similarity -> trusted candidate context`.

## Security implications

The experience graph is a persistent poisoning surface, so V1.28 makes its writer boundary stricter than ordinary memory:

- candidate cannot write cases;
- candidate cannot edit utility;
- candidate cannot mint correction edges;
- candidate cannot widen graph-retrieval thresholds;
- raw page/user/model transcripts are excluded;
- similarity does not authorize reuse;
- utility is contextual;
- retrieval does not authorize execution or promotion.

The policy path itself is added to:

- isolated Candidate Builder immutable exact paths;
- RSI tournament trust root;
- RSI promotion trust root.

## Relationship to concurrent skill evolution

The V1.24–V1.27 skill line and V1.28 experience graph solve different problems.

Skill line:
- what reusable procedure exists;
- how reliable is it;
- how broad is its verified scope.

Experience graph:
- where did evidence come from;
- which failures were corrected by which later cases;
- which cases are relationally relevant now;
- how useful was a case in a specific target context.

Later convergence should connect verified skill versions to graph case nodes by digest, not merge the two authority models.

## Non-goals

V1.28 does not:

- deploy a new Supabase graph schema;
- store raw Browser trajectories;
- expose page/user text;
- train embeddings;
- make similarity authoritative;
- infer global utility;
- auto-inject cross-context memory;
- create Browser effects;
- create DevOS tasks/leases;
- mutate production;
- archive/promote candidates;
- install/self-update.

## Next research slice

The next high-value extension is **graph-governed consolidation and forgetting without destructive mutation**:

- retain append-only source cases;
- materialize compact semantic summaries as derived nodes;
- support utility-aware pruning views rather than deleting history;
- preserve warning/failure cases so the graph does not become success-only survivorship bias;
- detect poisoned or stale subgraphs through external target-context feedback;
- expose snapshot-diff/time-travel queries for incident reconstruction.

This should borrow ExpGraph/SAGE reader-writer feedback while preserving immutable source evidence.
