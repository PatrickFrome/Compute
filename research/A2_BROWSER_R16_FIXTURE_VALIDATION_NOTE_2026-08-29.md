# R16 Canonical Enum Validation Repair

The first R16 gate (`33238121000`) failed in the adversarial router tests before any routing decision because the executor `session_class` lexical validator accepted only `[A-Z_]` while the canonical enum includes `A2_DEDICATED`.

This is a bounded input-validation mismatch, not a filter/score architecture failure. The repair uses the same digit-bearing uppercase enum token grammar already used for request enum lists: `[A-Z][A-Z0-9_]{1,63}`. No executor was made newly eligible outside the closed canonical enum sets, and no routing/authority/effect semantics changed.

The final R16 lineage must also bind the later authoritative R15 head `65b0a8d24ff418bfbc2ebdec8d2700f8f253b22f`, whose later hardening evidence requires draining nodes to receive no new work while preserving already-bound exact-incarnation leases. R16 already filters every non-`HEALTHY` executor, so `DRAINING` remains ineligible for new routing.
