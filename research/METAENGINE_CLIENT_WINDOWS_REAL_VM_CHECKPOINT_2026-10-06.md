# METAENGINE Client — Windows Real VM Qualification Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — CLIENT QUALIFICATION ONLY**  
Branch: `work/client-windows-real-vm-install-e2e-v1`  
Implementation commit: `23041a50cebcd417b572ce14abb06530cee00a6f`

## Roadmap reconciliation

Canonical Level-1 owner: **C2 — First Serial Coding Loop (preparatory client evidence only)**.

This checkpoint does **not** satisfy canonical C2. The canonical acceptance event still requires:

`repo checkout → isolated edit → real build/test → verified artifact → serial loop end-to-end`.

The primary canonical spine remains `R1 → C1 → C2`. R1 and C1 are not promoted by this work. This slice only removes one client-side ambiguity: whether the qualified installer can be installed, launched, inspected, and cleanly removed on a fresh real Windows VM.

Client roadmap relation:

- C4 physical Agent-origin qualification remains a distinct live gate.
- The next client product gate is C5 useful verified work: one exact goal must produce repo/edit/test/artifact evidence and independent acceptance.
- This checkpoint must not be substituted for either live Agent-origin proof or useful-work proof.

Real-compute effect: **yes, bounded** — a real GitHub-hosted Windows VM installed and executed the real immutable client binary.  
Control-plane-only: **no**.  
Production authority effect: **false**.

## Exact evidence

Workflow: `Client Windows Real VM Install E2E`  
Run: `37392041550`  
Job: `112039150521`  
Run number: `1`  
Event: `push`  
Conclusion: **SUCCESS**  
Exact workflow head: `23041a50cebcd417b572ce14abb06530cee00a6f`

The workflow changed no client source. Relative to parent `acbdab774f007fa51095e7331119e700638c8bd0`, the implementation commit adds only:

`.github/workflows/client-windows-real-vm-install-e2e.yml`.

The tested client tree was independently diffed against producer source:

`eb08a46ad5093bfb0b2e17da6acc6b01fb9996f8`

for:

- `apps/metaengine-browser`
- `apps/me2-ui`
- `apps/me2-daemon`

and the diff was empty.

## Fresh Windows VM identity

The workflow recorded:

- runner OS: `Windows`
- architecture: `X64`
- image OS: `win25-vs2026`
- image version: `20260925.250.1`
- OS: `Microsoft Windows Server 2025 Datacenter`
- build: `26100`
- manufacturer: `Microsoft Corporation`
- model: `Virtual Machine`
- hypervisor present: `true`
- logical processors: `4`
- physical memory: ~16 GiB
- CPU: AMD EPYC 9V45

Before installation the workflow required all of the following to be absent:

- install root
- uninstall registry entry
- `METAENGINE Browser Test.exe` process

The clean-host precondition passed.

GitHub's current runner documentation states that standard GitHub-hosted Windows jobs run on a fresh VM instance. Source: https://docs.github.com/en/actions/reference/runners/github-hosted-runners

## Immutable producer binding

The consumer did not rebuild the application.

Bound producer:

- workflow: `browser-windows-package-smoke.yml`
- source head: `eb08a46ad5093bfb0b2e17da6acc6b01fb9996f8`
- producer run: `37359662845`
- producer run number: `3381`
- producer attempt: `1`
- artifact ID: `11366401470`
- artifact name: `metaengine-browser-windows-candidate-eb08a46ad5093bfb0b2e17da6acc6b01fb9996f8`
- artifact digest: `sha256:79c2a15ae91c45f3ae674e6f12d980177d7f50fdf6af5e22c1d95f6c6ff62380`

Installer:

`METAENGINE-Browser-Test-Setup-0.7.0-dev.37350000001.1-x64.exe`

Installer SHA-256:

`b71ffe36fcaae6e7c2bd2cff282f999541028138cc54413b0556bd37192a35a9`

The consumer verified:

- installer provenance schema v3
- exact producer source/run/workflow binding
- Build Identity V3
- dependency-resolution digest
- package-lock material
- npm version `11.19.0`
- Bun version `1.3.3`
- ME2 UI Bun lock digest
- blockmap digest
- electron-builder config digest

No second NSIS build was performed.

This follows the same principle as SLSA provenance: consumers verify artifact identity and production provenance rather than trusting only a filename or successful build status. Sources:

- https://slsa.dev/spec/v1.2/provenance
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations

## Physical install/runtime result

Real NSIS silent install: **PASS**.

Installed executable:

`C:\Users\runneradmin\AppData\Local\Programs\METAENGINE Browser Test\METAENGINE Browser Test.exe`

Installed executable SHA-256:

`b77e08c819a4e013830731836a9191819f9db9bd071318e04e67638c91f8840e`

ME2 UI installed-runtime proof:

- schema: `metaengine.browser.me2.installed-ui-proof.v1`
- source head: exact producer head
- manifest bytes: `38,791,933`
- installed bytes: `38,791,933`
- runtime smoke: **PASS**

ME2 daemon installed-runtime proof:

- schema: `metaengine.browser.me2-daemon-installed-proof.v1`
- version: `0.57.1`
- embedded runtime: `true`
- external Bun required: `false`
- runtime smoke: **PASS**
- provider/model/agent-command mutation capabilities: disabled in probe mode
- authority effect: `false`

Additional physical checks:

- version probe: **PASS**
- profile probe: **PASS**
- user data path resolved by installed Electron itself
- normal installed UI remained alive after 10 seconds: **PASS**

## Physical uninstall result

Real NSIS silent uninstall: **PASS**.

Post-uninstall:

- installed binary absent
- install root absent
- uninstall registry entry absent
- browser process absent

Final proof fields:

- `uninstall_verified=true`
- `install_root_removed=true`
- `uninstall_registry_removed=true`
- `authority_effect=false`
- `published=false`
- `promotion_authorized=false`

## Evidence artifact

Artifact ID: `11381816132`

Name:

`metaengine-client-windows-real-vm-e2e-23041a50cebcd417b572ce14abb06530cee00a6f`

Artifact SHA-256:

`sha256:471926d01381204f81dc0c1e0a536b7bda2bcdb417894a5d46a2a5726a64587e`

The artifact contains VM identity, producer binding, installer verification, installed UI/daemon proofs, version/profile outputs, normal launch logs, and final uninstall proof.

## Adversarial / fail-closed properties

The workflow fails closed if:

- client source has drifted from the immutable producer source
- the host is not a Windows VM with an observed hypervisor
- the test host already contains the product
- artifact ID/name/digest/run/head do not match the pinned producer
- provenance/build identity/dependency material do not verify
- installer bytes drift
- installed UI or daemon smoke fails
- version or profile probe fails
- normal GUI exits early
- uninstaller cardinality is not exactly one
- executable/install root/registry/process survive uninstall
- qualification checkout mutates client source

## Non-claims

This checkpoint does **not** prove:

- Windows 11 Desktop compatibility
- reboot/login persistence
- autostart across a host reboot
- live ADMIN enrollment
- live z.ai Agent origin
- useful coding work
- independent result acceptance
- canonical C1 or C2 completion
- R1/R2/R3 completion
- production release authority

## Amplifier research conclusion

The next quality gain is not another installer smoke test.

A useful-work exit must bind one exact Client goal to:

1. exact repository/base checkout;
2. an isolated edit;
3. a real test/build execution;
4. a content-addressed output artifact;
5. independent artifact/provenance verification;
6. exact Agent-origin/result binding;
7. no blind replay after ambiguity.

GitHub artifact attestations and SLSA provenance reinforce the artifact side of this design: artifact acceptance should bind a subject digest to the producing source/builder and be independently verifiable.

The next implementation slice is therefore **Client C5 useful-work proof contract**, initially PREPARE_ONLY and fail-closed. A later physical/live qualification must supply the real evidence; synthetic fixtures cannot promote it to LIVE.

## Checkpoint state

**Client Windows VM install/runtime/uninstall qualification: EVIDENCE_READY.**

Canonical C2: **NOT_PROVEN**.  
Client C4 physical Agent-origin: **not promoted by this checkpoint**.  
Client C5 useful-work: **next implementation target**.
