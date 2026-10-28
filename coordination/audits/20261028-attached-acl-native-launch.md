# Attached PostgreSQL private-file ACL launch hardening

The Windows lab's storage/installer run on b9d2ba659 completed 46 tests:
34 passed, 11 failed, 1 cancelled, no skips. Ten installer fixture processes
were terminated at their 10-second harness limit before evidence was emitted.
The private-file protection operation returned its generic ACL failure, and
the repeated DACL scenario exceeded its aggregate180-second test limit.

Separate measured native PowerShell probes took40-50seconds to start and
finish even a trivial command. The failed private-file operation used a30s
budget. Timeout is a supported hypothesis for that generic failure, not yet
an independently recorded cause or a completed Windows repair qualification.

Source inspection additionally found both attached-private-file operations
resolved powershell.exe via PATH and inherited the entire parent environment.
They now invoke only the fixed C:\Windows system PowerShell, reject mismatched
SystemRoot, preserve only native profile/cache locations, and use a single
bounded120s attempt. Database credentials and custom PATH/PSModulePath are not
forwarded. Existing ACL scripts and failure codes remain unchanged; timeout
receipts add only a fixed native_query_timeout category, never child output.
Two portable tests reproduced the unpinned launch before the patch and now
check path/environment isolation, timeout, PID-independent fixed arguments,
fail-closed errors, untrusted root refusal, and absence of retries.

Test-only limits: installer fixture120s per process; repeated ACL test630s
for five separately bounded120s native calls plus cleanup. No production
installer deadline, consent, process-termination rule, or assertion weakened.

Linux focused:44tests31pass0fail13Windows-skips. Runtime full:726tests696pass,
1 environment Unix-socket EPERM failure,29skips. Browser full initially found
an unrelated two-Date.now fixture race; reproduced deterministically as90001ms
instead of90000ms and fixed separately in550f9d2f2 (5/5 focused pass).
Final integrated browser rerun is recorded separately.

Native Windows rerun of this patch is pending. The VM is stopped after its
second independently verified WLMS expired-Evaluation shutdown. No license
bypass, installed-client/Guardian/service mutation, or physical PostgreSQL
qualification is claimed. GitHub publication remains pending approval.
