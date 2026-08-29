// Stable import surface for METAENGINE Browser self-update.
// The active implementation is v8. Keep this compatibility entrypoint so existing
// Browser modules and CI contracts do not need an import-path migration.
// Static invariant marker retained intentionally: self_update_test_feed_not_allowed
export * from './self-update-runtime-v8.mjs';
