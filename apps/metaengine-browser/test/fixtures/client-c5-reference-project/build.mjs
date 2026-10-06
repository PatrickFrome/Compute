import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { answer } from './answer.mjs';

if (answer !== 42) throw new Error('client_c5_reference_build_answer_invalid');

const outDir = new URL('./dist/', import.meta.url);
await mkdir(outDir, { recursive: true });
const artifact = {
  answer,
  schema: 'metaengine.client-v1.c5-reference-artifact.v1',
  verified_behavior: 'answer-is-42',
};
await writeFile(new URL('./dist/reference-artifact.json', import.meta.url), `${JSON.stringify(artifact)}\n`, 'utf8');
process.stdout.write(`${path.basename(new URL('./dist/reference-artifact.json', import.meta.url).pathname)}\n`);
