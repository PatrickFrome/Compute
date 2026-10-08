# PostgreSQL Backup and Frozen Runtime Dependencies

Official documentation was checked on 2026-10-08 (Europe/Moscow). The implementation uses PostgreSQL 17.6 client tools, postgres.js 3.4.7 and Deno 2.9.7.

## PostgreSQL

- [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) states that a dump is consistent while readers/writers continue. A custom archive (`-Fc`) supports inspection, selection/reordering and parallel restore. `--snapshot` lets a concurrent inventory session and the dump use the same exported snapshot. `--lock-wait-timeout` prevents waiting indefinitely for the initial shared table locks.
- [PostgreSQL 17 pg_dumpall](https://www.postgresql.org/docs/17/app-pg-dumpall.html) explains that roles, tablespaces and configuration parameter grants are global objects, not part of a single-database pg_dump. `--roles-only --no-role-passwords` reads pg_roles rather than restricted pg_authid; restored passwords are null until set separately. Our Supabase role reconstruction is an explicit compatibility step from visible role and membership metadata, not proof that unavailable password hashes were backed up.
- [PostgreSQL 17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html) documents `--list`/`--use-list` for selected archive entries, `--exit-on-error` to avoid continuing after failed SQL, and `--single-transaction` for all-or-nothing restoration. Parallel jobs cannot be combined with a single transaction. A phased extension compatibility restore therefore needs a receipt for every selected/excluded archive entry and each transaction boundary.

The custom archive remains immutable. Preserve its digest, snapshot inventory, visible global role metadata and exact restore selections. A verified data restore is distinct from a byte-identical schema/platform restore: collations, extension providers, unavailable Vault root keys, role passwords, Edge secret plaintext and external Storage payloads require separate evidence. Source SQL executes with source-superuser-defined behavior during restore, so local restoration should occur in a qualified isolated cluster using the inspected source and a recorded compatibility plan.

## Deno

- [Deno dependency management](https://docs.deno.com/runtime/packages/) describes lockfile/integrity handling for the dependency graph.
- [Deno run reference](https://docs.deno.com/runtime/reference/cli/run/) states that `--frozen-lockfile` errors when the lockfile is out of date and `--cached-only` requires remote dependencies already cached. `--node-modules-dir=none` resolves npm packages from Deno's global cache.
- [Deno security and permissions](https://docs.deno.com/runtime/fundamentals/security/) recommends determining loaded code upfront and restricting further loading with a frozen lockfile and cached-only mode in addition to limited permissions.

The local launcher now uses the checked-in lock for exact `npm:postgres@3.4.7` and its registry integrity, frozen lockfile and cached-only startup. Dependency installation is an explicit preparation step, separate from running the local service. The startup receipt hashes both Node and resolved Deno npm package files, the selected relative source closure including side-effect imports, lock files and executable bytes before and after readiness. Loader-injection environment variables and unrelated access tokens are removed from server children. Keys and connection URLs are excluded from manifests.

## Remaining Gaps

File hashes and a launcher receipt prove which selected bytes were present before and after startup. They do not cryptographically attest loaded process memory, dynamic PostgreSQL libraries, compiled Deno caches or the operating system. The signed verification checks the actual startup UUID, endpoint, manifest digest, current module/package bytes and health, and calls its result `STARTUP_MANIFEST_BOUND_SMOKE` without inferring code identity from the database capability contract.

Next useful hardening is a packaged dependency cache or vendored distribution with a reproducible platform manifest and controlled immutable release directory. It should include PostgreSQL libraries and extension provider binaries, verified installation and restore rehearsal, rather than relying on an unqualified global cache. A database dump alone cannot recover a local Vault without its separately protected key, nor rebuild unavailable plaintext Edge secrets.
