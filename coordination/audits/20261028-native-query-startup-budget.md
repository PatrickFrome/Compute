# Windows native process read: measured startup budget

Windows 10 LTSC 2021 Evaluation, QEMU 10.0.13 TCG, 4 vCPU / 4 GiB.
On c917397360dd7c9799f7fe44bf6f0bbd9e797f07 the actual Windows six-suite
run had 70 passed, 2 failed, 1 skipped. Both physical process tests failed
with runtime_recovery_process_query_timeout_not_started at the 30s limit.

A separate bounded diagnostic ran the exact fixed production PowerShell
kernel query, without changing its PID/birth/image logic:
- Trivial command, minimal environment: 45,871ms, exit 0.
- Kernel query, minimal environment: 39,530ms, first script marker36,745ms.
- Trivial command, isolated profile: 49,985ms, exit 0.
- Kernel query, isolated profile: 40,491ms, first script marker37,843ms.
Both kernel reads returned identical PID and exact 100ns birth, with the
expected executable. Profile environment variables did not fix startup.

The native query now permits one bounded120s attempt, consistent with the
existing private storage ACL reader. No retry, script change, weakened
identity validation, environment expansion, or timeout-to-success conversion.
A portable contract test verifies the actual function's invocation options,
PID mismatch rejection and sanitized timeout phase. It failed before the
change. Six Linux suites:74tests72pass0fail2Windows-onlyskip.

Native Windows rerun remains required. This change is not installer/GUI or
own-PG qualification. VM additionally has unresolved OOBE and an expired
Evaluation license (WLMS planned shutdown), independent of METAENGINE.
