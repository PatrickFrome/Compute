# A2 Browser R7F.1 — Bounded Directory Enumeration Hardening

Date: 2026-08-28
Status: pre-R7G corrective hardening

## Problem found during R7G IPC review

R7F correctly bounded package bytes and package file count, but its directory helper first collected all directory entries into a `Vec` and only later applied downstream skill/package limits. A hostile or accidentally polluted skill root could therefore create CPU and memory amplification before the advertised limits took effect.

This is a cardinality/work-amplification bug, not a path-confinement escape. `openat2(RESOLVE_BENEATH|NO_SYMLINKS|NO_MAGICLINKS|NO_XDEV)`, hardlink rejection, special-file rejection, and mutation fencing remain unchanged.

## External comparison

### Cap'n Proto

Cap'n Proto explicitly distinguishes wire-byte limits from traversal/work limits. Its security model includes both total traversal limits and nesting limits because small or compact inputs can otherwise cause disproportionate processing. The A2 analogue is that a bounded package body is insufficient if directory enumeration itself remains unbounded.

Sources:
- https://capnproto.org/cxx.html
- https://capnproto.org/encoding.html

### Chromium Mojo

Chromium's IPC guidance treats data crossing a privilege boundary as adversarial and requires validation of offsets, sizes, arithmetic, and privilege-presuming inputs before acting. R7G will follow that rule at the IPC layer, but R7F must first ensure that one valid, tiny request cannot trigger unbounded filesystem traversal.

Source:
- https://chromium.googlesource.com/chromium/src/+/master/docs/security/mojo.md

## Design decision

Apply limits at the point of enumeration, before sorting, filtering, opening, or package processing:

- skill root: at most 128 directory entries total; lexically ignored junk still consumes the scan budget;
- one skill top-level directory: at most 8 entries, enough for the portable layout plus a small bounded rejection window;
- each resource directory: at most 65 entries, matching the package-file upper bound;
- `.` and `..` do not consume budget;
- exceeding a scan budget fails closed with `skill_loader_directory_entry_count_exceeded`.

The root limit intentionally counts invalid names. Otherwise an attacker could create an unlimited number of ignored names and recover the same amplification primitive.

## Why this precedes R7G

A bounded IPC frame over an unbounded backend would be a misleading security boundary. R7G should be able to state that every accepted request has bounded parser work *and* bounded source traversal work. This corrective step establishes that prerequisite without adding new authority, new dependencies, or Node integration.

## Non-goals

- no IPC implementation in this step;
- no process spawning;
- no Landlock policy yet;
- no change to package semantics or executable-resource treatment;
- no weakening of R7F confinement flags or inode-change checks.
