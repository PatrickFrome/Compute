# Selector publication process drain

Inspection of the installed Node child_process implementation shows execFile's
error handler invokes its callback before the child's close event. Promisifying
that callback therefore does not prove the owned PowerShell process has closed
after AbortError. The publication caller removes its staging file in finally;
returning early would let that cleanup overlap the still-owned File.Move.

The fixed native selector runner joins both callback outcome and child close.
Error output remains sanitized by the existing publication operation. The fixed
PowerShell command, same-directory names, no-overwrite move, request deadline,
abort signal, private environment and no-retry behavior are unchanged. A stuck
child keeps custody rather than pretending cleanup succeeded.

Tests execute the actual production runner function with controlled process
events, and also exercise a real Node child with execFile cancellation. Both
abort and success callbacks must wait for close. Local: eight passed, one
Windows-only File.Move test skipped. Windows CI must run that existing physical
move and the new cancellation regression; a Linux generated process is not
Windows File.Move proof.

Five recently introduced native trust/profile/publication modules are now in
the existing syntax-check catalog, with registration assertions. All five parse,
and the catalog gate still rejects the first failing parser without hiding it.

Preceding published ea751466 local complete Browser run: 6961 total, 6851 pass,
28 environment failures, 82 skips. Disposable real PG17 seed + commit rotation:
36/36 pass, zero skips. Its UI run 40928832221 passes all eight renderer scenarios,
including a hung connection invoke paired with failed work readiness. Artifact
12920518680 SHA256:
936977e3bce01dfdb18058bd24412f24872d618a0d733ae125ec050c9a3f42b8.
Those results do not qualify this newer selector drain source or installation.
