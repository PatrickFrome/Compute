# Canonical builder at the release authority boundary

Date: 2026-10-03. Implementation scope: pure source validation.

## Verified baseline

Physical source `a68774eb6ad5a0fe8014501163b0c67f608bed09` has 10/10
terminal-success physical workflows at attempt 1, plus source qualification
37087134491. Package Smoke 37087347663/#3157 is the sole installer producer.
Version: `0.7.0-dev.37086632570.1`.
Installer SHA-256: `937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`.
Build Identity V3: `f7d78fdaf7b89028341cc4d0ceb7a7f73ead9b3a323fc15d1560563d7d0c478c`.

The immutable package proof ZIP 11261117931 and SLSA verification ZIP
11261401099 were downloaded and their archive digests checked against GitHub.
Their source and builder agree with the exact producer. Installer candidate ZIP
11260817954 remains the qualified distribution artifact; it has not been rebuilt.
This source-only successor must receive a new version before any physical build.

## Reproducible defect

The existing gate checks SLSA schema, verified/trusted flags, safe builder string,
source, subject and digest, but accepts `github-actions:browser-release` as a
builder. Even with every other proof positive, the local gate can therefore
accept evidence claiming a different builder. The independent producer verifier
is stricter; trust should also be enforced at the consumption boundary.

## Research

- SLSA 1.2 verification:
  https://slsa.dev/spec/v1.2/verifying-artifacts
  Expected builder identity, canonical repository, build type and parameters
  must be checked after signature and subject verification. A producer-controlled
  trust flag does not replace locally configured expectations.
- SLSA builder definition:
  https://slsa.dev/spec/v1.2/build-provenance
  Consumers accept specific signer/builder combinations. The gate consumes the
  independent verifier's bounded evidence; it does not implement a second
  cryptographic verifier or assert a new SLSA security level.
- GitHub CLI policy:
  https://cli.github.com/manual/gh_attestation_verify
  Signer workflow/digest, source digest/ref and hosted-runner restrictions remain
  the cryptographic verifier's responsibility.

## Implementation

The existing release gate permits exactly Package Smoke in PatrickFrome/Compute
on the canonical release or dedicated physical branch. No prefixes, forks,
caller-provided allowlist, other workflow, tag or PR ref qualify.
The positive outcome remains a candidate for a separate journaled promotion;
the gate never changes authority, publishes a release, dispatches a task or retries.
All immutable-release, source, subject/digest and ancestry checks remain required.

24 focused tests include two valid producer identities, fourteen builder
substitutions, caller policy injection, six independent proof failures and the
read-only contract. Cross-platform source qualification runs the full Browser
suite and independent SLSA semantic verifier with frozen dependencies.

## Roadmap boundary

The qualified V3 package can be offered for installation independently of this
source hardening. Integrating this changed runtime into an installer requires a
fresh source/version and full physical qualification.

The next functional gate is useful work in an installed z.ai Agent session:
goal admission -> lease -> exact Agent-origin effect -> readback -> durable
verified result -> next cycle, then restart and ambiguity reconciliation. A green
package/SLSA matrix alone does not prove this autonomous development loop.
