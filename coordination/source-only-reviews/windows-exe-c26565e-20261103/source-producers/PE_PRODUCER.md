# PE transform producer prerequisites

The production package gate still accepts only identical complete image bytes.
No normalized-image admission or Windows qualification is enabled by this work.
The new source-only modules make a bounded next stage executable:

- `build/custom-electron-transform-inputs.json` records SRI-derived source
  metadata and hashes for 52 resedit/pe-library CommonJS modules, their package
  metadata and nine separately declared builder/fuse reference files.
- `scripts/custom-electron-transform-inputs.cjs` compares installed source
  bytes to that catalog without importing/executing dependency code. It reads
  only fixed project config/lock/icon paths and refuses an arbitrary expected
  ASAR path, callback or receipt flag. Its ASAR-header utility processes data
  only; it does not make that data authoritative.
- `scripts/custom-electron-pe-layout.cjs` audits a narrow fixed layout and
  nonresource byte preconditions. Every result remains HOLD, including a
  structurally acceptable resource change. Direct directory equality cannot
  prove that indirect imports/TLS/load-config/relocations or other consumers
  do not reference changed resource bytes.

Run the diagnostic from `apps/metaengine-browser`:

```sh
node scripts/custom-electron-transform-inputs.cjs
```

Exit 1/HOLD is deliberate. This workspace has no installed dependency sources,
and the original expected-resource producer is absent. Current reasons are
`LOCKED_INSTALLED_SOURCE_FILES_UNAVAILABLE`,
`IMMUTABLE_EXPECTED_ASAR_PRODUCER_UNAVAILABLE`,
`BUILDER_RESOLVED_METADATA_NOT_RETAINED`,
`EXACT_EXPECTED_IMAGE_SERIALIZER_UNAVAILABLE` and
`INDIRECT_LOADER_REFERENCE_CLOSURE_UNPROVEN`.

## Concrete producer and qualification steps

1. Extend the original source-authoritative ASAR writer to retain its completed
   immutable expected bytes/header and resolved appInfo/version/icon inputs
   before candidate readback. The current afterPack context exposes candidate
   resources and cannot supply its own expected integrity. Use a private
   producer-owned handoff, not a caller-provided expected path/hash/flag.
2. Verify the exact installed source closure against the lock-derived catalog
   before loading any transform module. Restrict module resolution to the
   reviewed graph; reject unexpected imports, aliases and mutation. The 52
   modules and nine reference files are data ingredients, not a full qualified
   transform-execution closure or release authority.
3. From the retained pristine unsigned image, deterministically serialize ASAR
   INTEGRITY/ELECTRONASAR resources, then required source-anchored fuse indices
   4/5, then exact product metadata/icon resources. Match pinned builder order:
   ASAR resources already precede afterPack; fuses/resources/signing follow it.
   Compare each candidate against every independently produced expected byte.
4. Independently enforce the narrow structural policy: unsigned PE32+ x64,
   fixed section/raw/RVA/aligned spans, no overlap/growth/movement, resources
   readable/nonwritable/nonexecutable, all other headers and nonresource bytes
   unchanged except the exact source-anchored fuse positions; use the exact
   checksum update. Unknown layouts remain HOLD.
5. Prove complete indirect-loader/reference closure for resource edits and
   exercise adversarial fixtures. The current structural audit records this
   unresolved obligation; it cannot replace it with a success boolean.
6. Qualify the exact retained producer, serializer, loader verifier and bytes
   on an authorized isolated Windows build host. Preserve existing internal
   release signatures, native admission and the user's Authenticode policy as
   separate requirements. Do not disable ASAR integrity/fuses to obtain equality.

There is no command or flag in this patch that fabricates these missing
implementations. A source-level test run using verified archive bytes as data
is not an installed dependency, executed vendor code, ready PE or working client.
