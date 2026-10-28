# Admission journal: reject unknown persisted history

Base: 1891d01e3e72661c33066ffe21e658aa6f3b796a.

Three disk-backed regressions demonstrated that JSON null, a journal without
its required latest field, and an unsupported nested attempt schema were
silently accepted. Null/missing-latest could be mistaken for a fresh profile;
unsupported attempts were relabelled as v1 by normalization.

Only ENOENT now means missing history. Existing snapshots must contain latest
(explicit null remains valid), and attempts must use the exact v1 schema.
Unknown bytes remain untouched; load and begin reject rather than overwrite.
No recovery retry, new authority, or automatic mutation was added.

Before: all three new tests failed with missing expected rejection.
After: 86 focused tests, 84 pass, 0 fail, 2 Windows-only skips on Linux.
Logs: windows-lab/evidence/admission-invalid-history-{before,after}.log
Windows execution of this change remains pending. This is not installed-client
or full package qualification.
