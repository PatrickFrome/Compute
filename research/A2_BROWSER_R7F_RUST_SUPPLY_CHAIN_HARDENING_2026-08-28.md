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
2. CI records the complete `Cargo.lock` and `cargo tree --locked` closure;
3. CI parses `Cargo.lock` with Python `tomllib` and fails if the known malicious names or compromised versions are present.

The lockfile check is structural, not a line-oriented grep, so package name/version pairing cannot be lost across TOML lines.

Source: https://blog.rust-lang.org/2026/08/20/supply-chain-attack-on-arrayref/

## Cargo symlink extraction advisory

A 2026 Cargo advisory described a cache overwrite issue involving symlinks in crate tarballs from third-party registries; crates.io was not affected because it rejects crate archives containing symlinks. Pinning the current Rust/Cargo toolchain avoids intentionally building this new boundary on an old Cargo release, while R7F itself independently rejects symlink traversal at runtime with `openat2`.

Source: https://blog.rust-lang.org/2026/04/22/cve-2026-5223/

## Lockfile promotion from the first resolver gate

The first R7F CI attempt reached and successfully completed the pinned toolchain/dependency-closure stage before `cargo fmt --check` stopped the later source-contract stage. That successful resolver stage produced the exact lockfile for the pinned manifest and Rust 1.98.0:

- `rustix 1.1.4`
- `bitflags 2.13.1`
- `linux-raw-sys 0.12.1`
- target-conditional closure recorded in the lockfile: `errno 0.3.14`, `libc 0.2.189`, `windows-sys 0.61.2`, `windows-link 0.2.1`.

Because dependency resolution itself was already proven, the follow-up formatting fix promotes that exact machine-generated `Cargo.lock` into Git source immediately. Subsequent CI no longer runs `cargo generate-lockfile`; it requires the source lockfile and uses `cargo tree --locked`, `cargo clippy --locked`, and `cargo test --locked`.

This is stricter than repeatedly resolving dependencies until the first full source test pass.

## Trust boundary conclusion

Dependency provenance and source-loader confinement solve different problems and neither substitutes for the other. R7F therefore requires both:

- supply-chain closure: exact compiler + exact direct dependency + source-controlled lockfile;
- runtime confinement: `openat2` capability-root resolution, no fallback, bounded regular-file reads, hardlink rejection, nonblocking special-file defense, and mutation fences.
