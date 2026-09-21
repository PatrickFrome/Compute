'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const runtimeRoot = String(process.env.METAENGINE_COMPUTE_BRIDGE_ROOT || '').trim();
if (!runtimeRoot) {
  process.stderr.write('compute_bridge_runtime_root_missing\n');
  process.exitCode = 1;
} else {
  const entry = path.join(runtimeRoot, 'src', 'cli.mjs');
  import(pathToFileURL(entry).href).catch((error) => {
    process.stderr.write(`compute_bridge_worker_failed:${String(error?.message || error).slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}
