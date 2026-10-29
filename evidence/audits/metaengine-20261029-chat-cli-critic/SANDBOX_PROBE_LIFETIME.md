# Sandbox preparation probe: owned lifetime failures

The default profile preparation remains unimplemented. Inspection of its existing
sandbox probe prerequisite reproduced three concrete lifetime failures in the
actual runCodexCliSandboxProbe function: a second log-open failure leaked the
first handle; an observer exception returned before owned process completion;
and an uncertain resume returned without requesting termination or closing logs.

The probe now closes partial log acquisition, joins owned completion after
observer/resume failure, drains already-started observations/log writes, and
closes both logs even after flush failure. Both sync operations settle before
handles are closed; one failed sync cannot release the other pending operation.
A failed termination request cannot be mistaken for completed process cleanup.
Failure produces no successful probe receipt and does not delete uncertain
workspace/canary evidence. No process retry, model request or new authority is
introduced. Existing process controller remains the physical authority.

Seven lifecycle cases execute the shipped function with explicit generated
filesystem/process adapters, not Windows sandbox evidence. They cover partial
open, observer failure, resume failure, spawn failure, failed terminate request,
log-sync failure and a still-pending sibling sync. The first three reproduced
failures before the fix. Combined existing probe + lifecycle + registration:
25 pass, one Linux skip for the existing Windows-only native boot observation.
The Windows workflow now includes both probe files and the real boot identity
read. Actual Codex elevated-sandbox qualification on the installed client is
still required; the synthetic lifecycle adapters cannot establish it.

Previous published 6466dac8d45838e1a10a0d526154a2c2b36a5282 completed both CI
runs successfully: Windows Source 40934014328 (452/453 component with one baseline
skip, native PG17 47/47 without skips) and Runtime Contracts 40934014281 (PG,
Ubuntu, Windows). Its additional local broad Browser run was interrupted by a
reported api.github.com network policy block and has no final test total. The
previous complete local ea751466 run remains 6851 pass / 28 environment failures /
82 skipped, not a full local green claim for this newer source.
