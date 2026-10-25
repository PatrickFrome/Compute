import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let nodeSha;
// Real copied source and pinned Node; fixture authority/lease callbacks remain
// explicitly generated and must not be represented as installed native proof.
export async function agentBridgePins(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-agent-bridge-pins-'));
  t.after(async()=>{const actual=await fs.realpath(directory);assertTemporary(actual);await fs.rm(actual,{recursive:true,force:true});});
  const files={entrypoint:'native-coding-agent-mcp-entry.mjs',broker:'native-coding-agent-mcp-broker.mjs',adapter:'native-coding-agent-mcp-stdio.mjs'},bridgeSha256={};
  for(const [key,name]of Object.entries(files)){
    const bytes=await fs.readFile(new URL('../../src/'+name,import.meta.url));bridgeSha256[key]=hash(bytes);await fs.writeFile(path.join(directory,name),bytes);
  }
  nodeSha??=hash(await fs.readFile(process.execPath));
  return {nodeExecutable:process.execPath,nodeSha256:nodeSha,entrypointPath:path.join(directory,files.entrypoint),bridgeSha256};
}
function assertTemporary(directory){
  if(!directory.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(directory).startsWith('metaengine-agent-bridge-pins-'))throw Error('fixture_cleanup_scope');
}
