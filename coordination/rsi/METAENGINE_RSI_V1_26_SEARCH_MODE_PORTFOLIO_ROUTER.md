# METAENGINE RSI V1.26 — Contextual Search-Mode Portfolio Router

Status: SOURCE IMPLEMENTED / STACKED ON V1.25 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-fixed-skeleton-mutation-v1 @ 5d9fe2346da8106328d455180b4227b6de8b2019`

Implementation branch:

`work/metaengine-rsi-search-mode-router-v1`

## Purpose

METAENGINE RSI now has several distinct ways to search for an improvement:

- V1.25 fixed-skeleton critical-block evolution;
- V1.16 broad bounded architecture search;
- V1.23 fixed-operator recursive depth;
- V1.18 comparative lineage mutation.

No single search mode should dominate every problem class.

V1.26 learns which search mode has historically produced verified gains for a **typed external context**, while preserving explicit exploration.

The router allocates **proposal budget only**.

It cannot schedule, evaluate, archive, promote or execute a candidate.

## Research basis

### AEL — learn which strategy to use

Agent Evolving Learning argues that open-ended improvement depends not only on storing experience but on learning how to use it. Its implementation uses bandit-style policy selection across planner/tool/memory choices, with Thompson Sampling for retrieval and a contextual planner selector.

METAENGINE generalizes the strategy-selection idea to the outer RSI search mode:

`context -> search mode portfolio allocation`

Reference: Xu et al., *AEL: Agent Evolving Learning for Open-Ended Environments*, arXiv:2604.21725.

### ADAS — the search space itself matters

Automated Design of Agentic Systems frames improvement around:

1. the agent-system search space;
2. the search algorithm;
3. evaluation.

METAENGINE now has multiple bounded search spaces. V1.26 treats choosing among them as its own learned allocation problem rather than hard-coding one universal search representation.

Reference: Hu, Lu & Clune, *Automated Design of Agentic Systems*, ICLR 2025.

### FunSearch and Meta^n — different problem structures want different operators

FunSearch demonstrates that a fixed skeleton with only a critical evolved function can be much more efficient when the surrounding program structure is known.

Meta^n demonstrates that some problems benefit instead from deeper recursively generated strategic layers using one fixed meta-operation.

V1.26 therefore does not force these mechanisms into one representation. It routes proposal budget between them.

## Typed search context

Schema:

`metaengine.rsi.search-context.v1`

Context is externally produced and contains only typed fields:

- mutation surface;
- problem class;
- budget class;
- whether a trusted skeleton exists;
- whether trace history exists;
- lineage candidate count;
- optional failure class;
- novelty pressure.

Raw page text and raw user input are explicitly absent.

Candidate code cannot edit the context.

## Search modes

Current modes:

- `FIXED_SKELETON`
- `BROAD_ARCHITECTURE`
- `RECURSIVE_DEPTH`
- `COMPARATIVE_LINEAGE`

Compatibility is externally fenced:

- FIXED_SKELETON requires a trusted skeleton;
- RECURSIVE_DEPTH requires trace history;
- COMPARATIVE_LINEAGE requires at least two lineage candidates;
- BROAD_ARCHITECTURE is the general fallback.

## Outcome evidence

Schema:

`metaengine.rsi.search-mode-outcome.v1`

Only external evaluator evidence is admitted.

Every outcome records:

- exact search context digest;
- search mode;
- externally verified net-benefit result;
- hard-invariant status;
- candidate validity;
- cost units;
- evaluation digest;
- evidence refs.

A positive outcome is impossible unless both candidate validity and hard invariants passed.

Outcome evidence is routing evidence only, never promotion authority.

## Routing

Schema:

`metaengine.rsi.search-mode-routing.v1`

For compatible modes the router derives:

- historical attempts;
- verified gains;
- invalid/hard-failure rate;
- average cost;
- smoothed success estimate;
- bounded UCB-style uncertainty bonus;
- novelty-pressure term.

The uncertainty bonus is intentionally small because V1.26 has an explicit exploration lane.

This avoids the common error of letting optimism bonuses turn the exploitation lane itself into random exploration.

## Explicit exploration

When more than one compatible mode exists, the budget is split:

- EXPLOIT — highest externally supported utility/cost score;
- EXPLORE — least-tested compatible mode with high uncertainty.

The exploration fraction is externally fixed for the routing episode.

This prevents one early winner from permanently monopolizing the RSI search budget.

## Authority boundary

The output is only a proposal-budget allocation.

It is explicitly not:

- scheduler authority;
- evaluator authority;
- archive authority;
- promotion authority;
- Browser/process authority;
- self-update authority.

The candidate cannot choose the mode or edit historical statistics.

## Trust root

`apps/metaengine-browser/src/rsi-search-mode-router.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

## Non-goals

V1.26 does not:

- create tasks or leases;
- execute a selected search mode;
- fabricate evaluator outcomes;
- let model text define context;
- promote a search mode globally;
- eliminate explicit exploration;
- mutate production;
- install or self-update.

## Next direction

The next high-value mechanism is a **reliability-aware evolutionary memory compression layer**.

The RSI stack is accumulating many typed lessons, attributions, transfer receipts, proxy calibrations and search outcomes. A future layer should compress them into bounded sufficient statistics while retaining exact provenance and reconstructability, preventing context/memory growth from becoming the next bottleneck.

Any compression must be externally verifiable and loss-aware; raw summaries produced by the candidate must not become trusted evidence.
