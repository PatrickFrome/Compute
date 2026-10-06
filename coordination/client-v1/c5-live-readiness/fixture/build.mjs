import { mkdir, writeFile } from 'node:fs/promises';

import { answer } from './answer.mjs';

if (answer !== 42) throw new Error('client_c5_live_build_answer_invalid');

const outDir = new URL('./dist/', import.meta.url);
await mkdir(outDir, { recursive: true });
const artifact = {
  answer,
  schema: 'metaengine.client-v1.c5-live-artifact.v1',
  verified_behavior: 'answer-is-42',
};
await writeFile(new URL('./dist/live-artifact.json', import.meta.url), JSON.stringify(artifact) + '\n', 'utf8');
