# METAENGINE Browser — Step 4 Windows lifecycle repair research

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`
Scope: restore a physical Development Plane proof on Windows without weakening the browser security boundary.

## Observed failure

Exact-head run `33245804117` at `4394a24a794e6158b3d06118a088ada6e972081a` proved the Linux shell contract, B-line contracts, and Linux Development Plane diagnostic, but the target `windows-latest` physical Development Plane gate failed. Therefore the shell is not promoted to an authoritative checkpoint yet.

The prior smoke emitted its success receipt before requesting process termination and immediately called `app.exit()`. That did not establish that the Chromium UtilityProcess had actually exited. The Windows evidence upload path was also inconsistent with the directory in which the evidence step created files, which could hide the diagnostic payload.

## External research

### Electron process boundary
Electron documents `utilityProcess.fork()` as a Chromium Services API child process with Node.js and MessagePort support. The correct architectural boundary is therefore main-process orchestration -> typed utility-process protocol, not remote renderer -> Node execution.
Source: https://www.electronjs.org/docs/latest/api/utility-process

### Remote renderer isolation
Electron security guidance explicitly requires remote content to run without Node integration, with context isolation and process sandboxing, and requires validation of IPC senders. METAENGINE Browser keeps ChatGPT in a sandboxed `WebContentsView`; Development Plane remains unreachable from page content.
Source: https://www.electronjs.org/docs/latest/tutorial/security

### Self-development supply chain
SLSA 1.2 defines provenance as verifiable information binding outputs to source/build process. GitHub artifact attestations use signed provenance and Sigstore; TUF separately addresses rollback/freeze/update metadata attacks. These mechanisms should back a later promotion plane, rather than granting the embedded developer direct replacement authority over the running browser.
Sources:
- https://slsa.dev/spec/v1.2/provenance
- https://docs.github.com/en/actions/concepts/security/artifact-attestations
- https://theupdateframework.io/docs/security/

## Repair decisions

1. Add exact worker version to the Development Plane READY handshake.
2. Add `stopAndWait()` with a bounded timeout and an explicit STOPPED receipt.
3. Make physical smoke success require verified child exit before `app.exit()`.
4. Preserve `automatic_restart=false`: a lost or stuck worker is surfaced, never silently replayed.
5. Fix the Windows artifact path so stdout/stderr survive a failure.
6. Keep current DP capabilities read-only. No arbitrary shell, eval, filesystem mutation, binary replacement, or direct promotion is introduced in this repair.

## Post-repair gate

The Windows target gate must prove all of:
- exact READY version/capability handshake;
- HEALTH response;
- repository-head read;
- `direct_promote_current=false`;
- explicit `shutdown.state=STOPPED`;
- Electron process exit code 0.

Only an exact-head green run can become the DP0 baseline for the next milestone.

## Next milestone after green DP0

`DP1_CANDIDATE_CAPSULE_PROVENANCE_V1`

DP1 should create a non-promotable candidate capsule containing source identity, declared change set, verification plan, evidence digests, and provenance metadata. Promotion remains a distinct policy gate; remote ChatGPT content has zero authority over it.
