# Apply the exact e30 parent/child patch

The source ZIP is `METAENGINE-e30-github-only-source.zip` with SHA-256
`169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06`.

Independent source tree (Git SHA-1):
`90fa5633d7926dd71a7303266073e0625325e740`.

**Apply only to this tree**, preserving executable bits (74 files). This is a
source-only patch, not an installer or a GitHub branch checkout. The existing
published GitHub commit `d53ccd...` is *not* the reconstructed source tree.

From the extracted `Compute/` root:

```sh
git apply --check /path/to/METAENGINE-e30-parent-child-tree90fa5633.patch
git apply /path/to/METAENGINE-e30-parent-child-tree90fa5633.patch
node --test apps/metaengine-browser/test/meta-orchestrator-parent-child-exact-tree.test.mjs
```

For broader inert tests use Node's built-in test runner on the 16 source-only
`meta-orchestrator*.test.mjs` / `meta-devos-superstep.test.mjs` files, **excluding**
`meta-orchestrator-local-endpoint.test.mjs` and
`meta-orchestrator-native-provider-client.test.mjs` (these create HTTP listeners).

No merge, database, services, PC, or installer operation is authorized by these
steps. The read-only completion projection is not durable completion authority.
