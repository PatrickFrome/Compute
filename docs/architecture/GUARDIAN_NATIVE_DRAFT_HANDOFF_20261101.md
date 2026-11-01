# Guardian native draft: source handoff, 2026-11-01

## Status and exact ancestry

**UNQUALIFIED DRAFT. Windows native compilation/execution is UNQUALIFIED. Stop-race independent review is PENDING. Not an installer-ready release or loaded-code proof.**

Separate branch: `work/native-guardian-custody-20261101`.
Public base: `0e43a569ad52134bee65dea3182ee9a4c4bbc56f`.
Applied in order, without conflicts:

| Original source | Rebased source | Scope |
| --- | --- | --- |
| `bfa15ab4294b998f7283029782b49ef658019583` | `22b0948f` | Fixed existing-root signature primitive |
| `9bc99cd46f29975355c77ec72064599683d76455` | `337c6cb8` | Pending pipe I/O ownership and completion join |
| `e5d7198b219ecb3352c7e9a06f7ce2f2112488bd` | `61c126e6bc7eb7b5df4fecb099060768256f68cd` | Preliminary service-owned stop/effect admission |

No default execution gate, production signature build dependency, installer, trust root, migration or release version is enabled/changed by this draft. The base release seal is inherited historical evidence for its exact base, **not attestation of this descendant**. No new canonical dump or qualified release seal is claimed.

## Boundaries

* Signature: production API pins the existing release public key; generic RFC8032 verification is test-only. Canonical bytes match W77 including reserved-identity refusal. Genuine production-root positive signature remains unavailable. A signature does not attest installed files, process origin, runtime loading, freshness or Owner authority.
* Pipe lifetime: pending connect/read/write retain the exact OVERLAPPED, event and buffer until terminal completion. Cancellation timeout remains owned HOLD, not permission to free memory. Service teardown cannot claim STOPPED until worker completion. The Windows test includes five actual-kernel scenarios and one explicitly injected cancellation-delay scenario; none ran in this Linux qualification.
* Stop admission: service-owned atomic STOP latch orders each new effect admission against stop. An already-admitted effect may settle after stop; subsequent stages must obtain another admission. No mutex is held across OS effects. Enrollment, protected-store create, directories, copy, durable ATTEMPTED barrier, suspended create and resume are guarded. Cleanup/readback of owned effects remains allowed. Portable model and source checks are **not** Windows effect execution, nor independent review approval.
* Authenticated request-session/root capability, retained release file/ancestor custody and controlled MAIN launch remain absent. Do not manufacture these capabilities from JSON, a public observation struct or caller-provided allow flag. RunAsNode sidecars remain separate and unchanged.

## Reproduced Linux checks

Environment: g++ 14.2.0, installed OpenSSL 3.5.7, Node v24.22.1. This installed crypto dependency is a Linux test dependency, **not a reviewed/pinned Windows static library**.

From repository root (use a disposable output directory):

```sh
Q=/tmp/guardian-native-draft-check
mkdir -p "$Q"
N=apps/metaengine-browser/native/browser-guardian-scm
g++ -std=c++20 -Wall -Wextra -Werror -pedantic -c "$N/browser-guardian-release-signature.cpp" -o "$Q/signature.o"
g++ -std=c++20 -Wall -Wextra -Werror -pedantic "$N/browser-guardian-release-signature-test.cpp" -lcrypto -o "$Q/signature-test"
g++ -std=c++20 -Wall -Wextra -Werror -pedantic -pthread apps/metaengine-browser/test/native/browser-guardian-effect-admission-model.cpp -o "$Q/admission-model"
METAENGINE_GUARDIAN_RELEASE_SIGNATURE_TEST_BINARY="$Q/signature-test" \
METAENGINE_GUARDIAN_EFFECT_ADMISSION_MODEL="$Q/admission-model" \
node --test apps/metaengine-browser/test/browser-guardian-*.test.mjs \
  apps/metaengine-browser/test/guardian-client-kernel-birth-w75.test.mjs \
  apps/metaengine-browser/test/guardian-owner-loaded-read.test.mjs
git diff --check
```

Result on the rebased source: **309 tests: 307 PASS, 0 FAIL, 2 SKIP**. Explicit skips: existing staging PowerShell Windows parse check; actual Windows named-pipe kernel probe. Production signature object and both test executables compiled successfully. No Windows compiler/service execution, installed-system mutation or signing took place.

## Review ownership and next evidence

* Stop/admission continuation owner: cloud thread `01a194a3-bb99-7102-a70b-4753d93f7020`. Review actual native effect interleavings, default-deny context and cleanup ownership before integration; do not replace this with source regex success.
* Loaded custody consumer: `01a194a3-ef09-7792-8e5e-b1fd96ec2019`.
* Crypto/build consumer: `01a1948b-c940-73f9-a6be-226987d9e025`. Qualify vetted static OpenSSL provenance/license/config and actual Windows production object/service linkage, without caller-selected roots.
* Windows pipe tests need the actual native test binary via `METAENGINE_GUARDIAN_PIPE_IO_TEST_BINARY`. Pending existing cloud build should not be duplicated by treating this handoff as an instruction to install/start a service.

Publication is for source accessibility and independent review on a separate draft branch/PR only. Do not merge this into the frozen main PR or promote readiness on the strength of this document.
