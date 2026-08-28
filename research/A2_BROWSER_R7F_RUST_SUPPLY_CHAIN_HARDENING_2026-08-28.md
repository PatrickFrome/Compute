# A2 Browser Operator R7F — Rust supply-chain hardening research

Date: 2026-08-28

## Why this is part of the implementation gate

R7F introduces the first Rust crate in the Compute repository. That expands the build trust boundary, so the compiler and dependency closure must be pinned and evidenced before the new filesystem helper can be treated as a safe improvement.

## Current toolchain baseline

Rust 1.98.0 was released on 2026-08-20. R7F pins the exact toolchain in `rust-toolchain.toml` instead of using the moving `stable` channel. The profile is `minimal` plus `clippy` and `rustfmt`, so CI does not implicitly install unrelated components.

Source: https://blog.rust-lang.org/2026/08/20/Rust-1.98.0/

## August 2026 crates.io supply-chain incident

The Rust project published an incident report on 2026-08-20 for a supply-chain attack involving malicious crates including `proc-macro1` and packages that incorporated it through compromised releases. The response specifically identified compromised versions of `arrayref`, `append-only-vec`, and `internment`, alongside additional malicious package names.

R7F responds in three ways:

1. exactly one direct third-party dependency: `rustix = 1.1.4`;
2. CI materializes and records the complete `Cargo.lock` and `cargo tree --locked` closure;
3. CI parses `Cargo.lock` with Python `tomllib` and fails if the known malicious names or compromised versions are present.

The lockfile check is structural, not a line-oriented grep, so package name/version pairing cannot be lost across TOML lines.

Source: https://blog.rust-lang.org/2026/08/20/supply-chain-attack-on-arrayref/

## Cargo symlink extraction advisory

A 2026 Cargo advisory described a cache overwrite issue involving symlinks in crate tarballs from third-party registries; crates.io was not affected because it rejects crate archives containing symlinks. Pinning the current Rust/Cargo toolchain avoids intentionally building this new boundary on an old Cargo release, while R7F itself independently rejects symlink traversal at runtime with `openat2`.

Source: https://blog.rust-lang.org/2026/04/22/cve-2026-5223/

## Lockfile rollout strategy

The initial R7F CI must generate `Cargo.lock` once so the repository obtains the real resolver output for the exact crate/toolchain combination. The workflow prints that lockfile into immutable evidence. Immediately after the first green R7F gate, the exact generated lockfile is promoted into Git source and the workflow is hardened from “generate then --locked” to “source lockfile must already exist and all build/test commands use --locked”.

This two-step rollout avoids hand-authoring a lockfile while still converging to a fully pinned build after one verified resolver run.

## Trust boundary conclusion

Dependency provenance and source-loader confinement solve different problems and neither substitutes for the other. R7F therefore requires both:

- supply-chain closure: exact compiler + exact direct dependency + audited lockfile;
- runtime confinement: `openat2` capability-root resolution, no fallback, bounded regular-file reads, hardlink rejection, and mutation fences.
