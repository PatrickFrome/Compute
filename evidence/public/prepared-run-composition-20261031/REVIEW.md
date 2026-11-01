# Prepared-run composition: source checkpoint

## Integrated registration checkpoint — 2026-10-31 15:25 UTC

Functional source `55cb3b34d92e7e992f33b6ee9e9478825fc4afd9` now includes the
reviewed SQL registration from `db59963561e3a9c6d584f9cff1e8dcbeaf3c17fc`.
Both migrations run through the existing atomic registry, always attesting the
reviewed bodies/ACL/triggers rather than trusting object presence. Duplicate
historical task generations abort the whole upgrade without deleting evidence.
The exact OWNER_ONLY canonical profile is accepted before API provisioning;
authenticated API evidence still requires its original direct grant. The private
runtime custody adapter remains opt-in: default Main/Host mount and execution
gates are still closed.

Evidence scopes, kept separate:

- `04af080c9cc369d5038ed672c9cd1d36a4a567e3`, identical Windows/cloud tree
  `72d68960fdb79f23cf78c4bfed78f57077a3db2d`: Windows real-PG selection 195/195,
  component selection 330 PASS plus two explicitly non-Windows-only skips.
  TAP SHA-256: native `1bd1177611dd1a3bdbf2211c25710b0aae99100b0bad98b21a965992b8701dc2`;
  components `c772b0be706e97003407db01b6a47e4727d439342d33f4a8c1e0c879d5fcdb92`.
- `a7411650c96a22435a32d344e34a51c76eefab08`: full Windows Runtime 832 PASS,
  14 skips, zero failures/cancellations; TAP SHA-256
  `e81c5b5256fede5533da587a2ebaee560f7b4822019c0cb73848171321dba04c`.
  Linux same source: 814 PASS, 31 skips,
  one `listen EPERM` failure before the Unix-socket ACL assertions. The Linux
  run is not green and its environment limitation was not hidden or bypassed.
- Earlier full Windows Browser source: 7,673 PASS, 25 skips, zero failures or
  cancellations. See `windows-source-checkpoint.json`; later runtime changes
  cannot inherit that full-suite qualification.
- Official lock-pinned Electron 44.9.3: actual isolated ASAR recovery test 6/6,
  no skips. TAP SHA-256 `0034a6497e88c47891627e42d815962f0767d9e3ff408293dead83175448a461`.
  The physical test is now mandatory in its existing Electron CI workflow.
- Integrated `55cb3b34`: real-PG publication/effect/transaction/fence/API/registry
  selections 211/211 on Linux and 211/211 on Windows, no skips or cancellations.
  Windows readback verified the same exact HEAD and tree
  `af055421e277581baa1da555828458b813ab1fbe`; TAP SHA-256
  `7a9aa13829bc86c334bd406f0eee81ff16a739b12a6dab2fbb30ecd0a2d7ca80`.
  This later result was read back at 15:30 UTC; no earlier full suite is promoted.
- Registered source `db599635`: independently reviewed registry 16/16; exact-head
  canonical export and restore on two disposable PG17.11 clusters, matching
  catalogue/ACL, no data or temporary API entries. Archive SHA-256
  `b70570a5c544b5d188b1c90afed5797fcdbc8f31f020b1d5310967db1a3b288b`, 974494 bytes.
  The manifest explicitly denies production qualification and installation
  authorization. Earlier API identity fixtures use trust authentication; the
  canonical factory additionally verifies a real SCRAM reconnect.

Remaining: installed-only read-only schema attestation and actual default
Host/Main/bridge wiring under genuine Owner/release custody; first-run and
historical-effect continuation qualification; exact final source CI; existing
release signer/sidecar placement; unique packaging and installed acceptance.
No installer or installed-service mutation is implied by this checkpoint.

## Historical composition checkpoint — 2026-10-31 07:28 UTC

Observed 2026-10-31 07:28 UTC. SOURCE TESTS ONLY; DEFAULT EXECUTION GATE CLOSED.

## Exact tested bytes

- Cloud functional source: `fc216b1d40593f5bc8638d3a64de640cb3682bf6`.
- Windows source: `fb58bc1613bc51e5393370983d014205003e1451`.
- Both committed trees: `9a5b6af962fd0d5111b93cf8644913760ae445e8`.
- Public predecessor at this observation: Draft PR #1392, `7599ccbfb2a8cd76b7db5d6207f32aa655895097`.
- Neither the current seal nor predecessor CI qualifies these later changes.

## Implemented source changes

1. Inert journal claim and a client-instance-owned single-use preparation token. Original RESERVED, six Owner cycles, matching initial publication acknowledgement, protocol settlement and physical callback/send join are all required before private custody can be taken.
2. The actual Host authority composes its original reservation with initial publication and independent committed readback. Later PUBLISH and AGENT Owner cycles stay on their existing physical request.
3. A private, single-use effect ticket binds the original context and actual transaction. AgentTools can execute its existing fixed operation inside that transaction, without nested begin. Owner recheck and the effect share the transaction.
4. Original cancellation propagates through reservation, advance and effect paths. A synchronous commit guard catches cancellation before COMMIT. A malformed or aborted Owner phase now aborts the actual original Host request; normal completion does not.
5. The publication PG fixture uses the existing production monitored transaction adapter. New qualification covers backend termination, callback join, retained physical HOLD and independent same-pool progress.
6. The ACL-close regression test now has bounded causal waits and rejects early read completion/failure rather than hanging. The production deadline was not extended.
7. Disposable PG socket configuration is written to the owned configuration file rather than passed through shell-dependent single quotes on Windows.

## Windows qualification on the exact tree

Node 24.21.0, PostgreSQL 17.11, postgres.js 3.4.7. Disposable profiles and generated PG clusters only. Process 5828 terminated with exit 0.

| Selection | Tests | Pass | Fail/cancel/skip | Duration | TAP SHA-256 |
| --- | ---: | ---: | --- | ---: | --- |
| Publication, AgentTools and monitored transaction real-PG fixtures | 111 | 111 | 0 / 0 / 0 | 70.529 s | `a6d2549e4036360a0f9921ae3dea2afb47b0707cc99730dc5f9ce624bf76c65d` |
| IPC, inert custody, initial contract, prepared reserve, handoff, Owner phases and AgentTools units | 253 | 253 | 0 / 0 / 0 | 59.629 s | `9e0144a25592a1a70303acc90aa7b08c7171069ea083152d9b0c7fd78641cb31` |

These are focused source selections, not full-suite, installed-native custody, release or useful model-work evidence. Owner/native inputs in generated fixtures do not become production trust.

## Failures retained and interpretation

- Public predecessor Current Source run 41172773632: Ubuntu and ME2 succeeded. Windows full Browser suite had 7,597 passes, one cancellation and 20 skips. The named cancellation was the ACL-close regression after 600,000 ms. The new bounded fixture passed locally; fresh full Windows CI remains required.
- Public predecessor checkpoint run 41172773776: one concurrent-prefix-CAS timeout cancelled its parent and caused downstream failures. Isolated Windows runs with both Node 24.19 and 24.21 did not reproduce the hang. The original hanging await is not proven. Using the real monitored production adapter removes the fixture/production transaction mismatch without retrying the CAS or weakening its one-winner/40001 assertions.
- Before the Owner-phase fix, the new real-PG boundary tests produced seven passes and four failures (including the failed parent). The original request was not being invalidated by a late phase failure. The final source passes the tests and preserves a durable effect if failure arrives only after COMMIT.
- The preceding Windows native selection had 93 passes and one failure during disposable PG startup. Its PG log showed a literal single-quoted socket directory. The corrected configuration passed the final 111-test selection.
- Public predecessor package run 41172773620 failed with `PACKAGE_IDENTITY_VERSION_ALREADY_RESERVED`. Version `0.7.0-dev.2257027431866.1` must not be reused. This source checkpoint reserves no version.

## Remaining before installation

- Joined proof of the genuine publication composition with the actual AgentTools message effect (current tests establish these pieces separately).
- Default Main/runtime prepared-reservation wiring, verified custody consumption by the bridge, mandatory initial PG anchor and durable cross-generation task fencing, including CRITIC.
- Historical effect reconciliation, first-run materialization and probe/run policy equivalence.
- Existing protected release signing capability, authenticated external sidecar placement and independently verified immutable artifact handoff. No new signing root or key is created.
- Fresh complete checks on the final sealed source, a unique package version, clean install/upgrade, data preservation, restart/restore/rollback and useful goal-to-worker-to-independent-critic continuation, with GLM before GPT.

No installer was built, signed or installed at this checkpoint. Installed Browser, Guardian and own PostgreSQL were not modified. No main merge, production SQL registration or default-gate promotion is implied.
