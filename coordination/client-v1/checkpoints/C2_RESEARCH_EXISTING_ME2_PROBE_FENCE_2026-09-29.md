# C2 Research Checkpoint — Browser Probe Already Fences ME2 Cloud Writers

Captured: 2026-09-29

## Question

Should Client V1 add another source contract after discovering a live legacy Bun ME2 writer to me2_event_mirror_h205f22?

## Existing exact-R109 coverage

apps/metaengine-browser/test/r99-me2-probe-authority-quarantine.test.mjs already proves:

- Browser probe does not seed full daemon authority;
- background drain/fleet/master/evidence loops are gated behind !PROBE_MODE;
- initEvidence() is not run in probe mode;
- SqlMirror is replaced by ME2_BROWSER_PROBE_READ_ONLY projection;
- sqlMirror.start() and token bootstrap are gated behind !PROBE_MODE;
- packaged Browser cannot select the historical full daemon via environment override.

apps/metaengine-browser/test/r108-final-authority-convergence.test.mjs additionally proves:

- packaged ME2 probe does not import legacy index.ts;
- packaged probe contains no SqlMirror;
- sql_mutation_enabled=false;
- provider/scheduler/browser/filesystem authority are false.

## Decision

Do not add a duplicate Browser source test.

The current incident is an EXTERNAL LEGACY RUNTIME problem, not a missing Browser-probe fence.

Post-restore work must focus on:
1. DB relation size and consumer census;
2. identifying the external writer owner/lifecycle;
3. stopping/quarantining that writer;
4. retention/storage budget;
5. preserving existing Browser probe tests unchanged.

Status: RESEARCH_COMPLETE
authority_effect = false
