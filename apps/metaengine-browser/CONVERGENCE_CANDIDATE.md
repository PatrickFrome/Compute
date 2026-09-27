# METAENGINE Browser convergence candidate

R97 single-main-workspace candidate. Package identity is `0.7.0-dev.4.1`.

This identity is intentionally distinct from the previously installed `0.7.0-dev.3.2`: the R97 candidate changes UI/runtime bytes and must not reuse an older package version. The canonical trusted-development version shape remains `<core>-dev.<monotonic-build>.1`, matching the existing release resolver and continuous self-update pipeline.

Primary UI contract:
- one persistent Chat Fleet workspace;
- supervisors and fleet chat agents on the left;
- exact selected native chat WebContents on the right;
- all advanced surfaces reachable only through Settings or command/search palette;
- no second scheduler, executor, browser-command authority, or retry plane in the renderer.

Safety invariants: no automatic retry of ambiguous browser effects, no authority widening, no bypass of self-update receipts, installer barriers, successor qualification, or Sentinel recovery fences.
