import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const phases = new Set(['isolated-windows-native', 'full-browser-suite']);
const imageLabel = value => typeof value === 'string' && /^[A-Za-z0-9._/-]{1,128}$/.test(value) ? value : null;

// CI observations only, not load attribution or a native qualification receipt.
// Never include environment dumps, CPU models, hostnames, paths or user data.
export function browserCiResourceObservation(phase, { environment = process.env, system = os, now = () => new Date() } = {}) {
  if (!phases.has(phase)) throw Error('browser_ci_observation_phase_invalid');
  return {
    schema: 'metaengine.browser.ci-resource-observation.v1', phase, observed_at: now().toISOString(),
    platform: process.platform, node_version: process.version,
    cpu_count: system.cpus().length, available_parallelism: system.availableParallelism(),
    total_memory_bytes: system.totalmem(), free_memory_bytes: system.freemem(),
    image_os: imageLabel(environment.ImageOS), image_version: imageLabel(environment.ImageVersion),
    contention_proven: false, native_qualification_proven: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('browser_ci_observation_arguments_invalid');
  console.log(JSON.stringify(browserCiResourceObservation(process.argv[2])));
}
