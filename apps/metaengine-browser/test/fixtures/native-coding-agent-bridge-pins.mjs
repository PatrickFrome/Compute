import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let nodeSha;
// Real copied source and pinned Node; fixture authority/lease callbacks remain
// explicitly generated and must not be represented as installed native proof.
export async function agentBridgePins(t){
  const temporary=await fs.realpath(os.tmpdir());
  const directory=await fs.realpath(await fs.mkdtemp(path.join(temporary,'metaengine-agent-bridge-pins-')));
  t.after(async()=>{const actual=await fs.realpath(directory);
    if(actual!==directory)throw Error('fixture_cleanup_scope');
    assertTemporary(actual,temporary);await fs.rm(actual,{recursive:true,force:true});});
  const files={entrypoint:'native-coding-agent-mcp-entry.mjs',broker:'native-coding-agent-mcp-broker.mjs',adapter:'native-coding-agent-mcp-stdio.mjs'},bridgeSha256={};
  for(const [key,name]of Object.entries(files)){
    const bytes=await fs.readFile(new URL('../../src/'+name,import.meta.url));bridgeSha256[key]=hash(bytes);await fs.writeFile(path.join(directory,name),bytes);
  }
  nodeSha??=hash(await fs.readFile(process.execPath));
  return {nodeExecutable:process.execPath,nodeSha256:nodeSha,entrypointPath:path.join(directory,files.entrypoint),bridgeSha256};
}
function assertTemporary(directory,temporary){
  if(path.dirname(directory)!==temporary||!path.basename(directory).startsWith('metaengine-agent-bridge-pins-'))throw Error('fixture_cleanup_scope');
}
