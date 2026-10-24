# Windows runtime continuity repair, 24 October 2026

This isolated client candidate advances the installed `0.7.0-dev.1107139874588.1`
to the distinct `0.7.0-dev.1107139874589.1`. It starts from source
`e450713ee609c4bd06f7e5423dd1f18026e19cbc` and contains only these repairs:

- Reject invalid protected Owner storage before scanning upgrade image trees
  (original change `dead9b91`).
- Invalidate Electron ASAR header caches before reading a replaced installed
  image, including its package metadata and runtime verifier (`29da809`).
- Reserve one API health request independently of the bounded application
  request capacity; run continuous PostgreSQL identity checks on one bounded
  connection while retaining independent startup `psql` qualification (`eff6f83`).

The native coding integration from the separate operator autonomy branch is
outside this candidate. The existing working Keeper and its database are not
test fixtures and are not restarted by this build.

The focused regression includes a generated disposable Windows PostgreSQL 17
cluster. It compares repeated continuity JSON identities with the production
startup `psql` inspector, checks that one continuity connection is reused, and
checks that closing the inspector releases it. ASAR replacement and API
overload regressions exercise the corresponding failure cases.

Each local build records its exact committed source, fresh own runtime source
bundle, dependency resolution, UI identity, toolchain hashes, installer and
ASAR hashes. Only previously verified third party runtime binaries and caches
may be reused. Old package bytes and old own runtime sources do not qualify
this version. The historical critical-closure ledger remains historical;
its old source-only candidate is not the package identity for this build.

This is a local unsigned QA candidate. Source tests and successful packaging
cannot establish production signing, installed runtime continuity, live agent
execution, independent Critic results or restart continuation. Those results
must be recorded from the exact resulting artifact and actual installation.
