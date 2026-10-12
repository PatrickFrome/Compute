#!/usr/bin/env node
// Read-only qualification of the standalone DevFleet unpacked Electron payload.
// Compares native source bytes with app.asar; never installs or runs the EXE.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const asar=require('@electron/asar');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const payload=path.join(root,'dist','win-unpacked','resources','app.asar');
const paths=[
 'src/main.mjs',
 'src/operator-core.mjs',
 'src/chat-surface.mjs',
 'src/fleet-observation-core.mjs',
 'src/ax-event-hints.mjs',
 'src/model-proof-core.mjs',
 'src/live-ui-slots.mjs',
 'src/index.html'
];
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const results=paths.map(relative=>{
  const source=fs.readFileSync(path.join(root,relative));
  const packed=asar.extractFile(payload,relative);
  return {path:relative,verified:sha(source)===sha(packed),
    sha256:sha(packed)};
});
const meta=JSON.parse(asar.extractFile(payload,'package.json').toString('utf8'));
const source=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const ok=meta.name==='metaengine-devfleet' && meta.version===source.version &&
  results.every(row=>row.verified);
console.log(JSON.stringify({
  schema:'metaengine.devfleet.packed-sources.v1',
  state:ok?'PASS':'FAIL',version:meta.version,files:results,
  asar_sha256:sha(fs.readFileSync(payload)),all_source_bytes_match:ok,
  installed_profile_touched:false,automatic_install:false
},null,2));
if(!ok)process.exitCode=1;
