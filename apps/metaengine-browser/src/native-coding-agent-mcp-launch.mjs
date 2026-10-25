import path from 'node:path';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {NATIVE_AGENT_MCP_ENV} from './native-coding-agent-mcp-entry.mjs';
import {NATIVE_AGENT_MCP_TOOLS,validateNativeCodingAgentMcpBinding} from './native-coding-agent-mcp-broker.mjs';

const SHA=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('native_agent_bridge_launch_denied');};
const quote=value=>JSON.stringify(value);
const verifiedLaunches=new WeakSet();
export const isNativeCodingAgentMcpLaunch=value=>verifiedLaunches.has(value);
async function pinnedFile(file,expected,maxBytes){
  if(!path.isAbsolute(file||'')||!SHA.test(expected||''))fail();
  const before=await fs.lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maxBytes||path.resolve(await fs.realpath(file)).toLowerCase()!==path.resolve(file).toLowerCase())fail();
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(file)){bytes+=chunk.length;if(bytes>maxBytes)fail();digest.update(chunk);}
  const after=await fs.lstat(file);
  if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes!==before.size||digest.digest('hex')!==expected)fail();
}

/** Explicit late-bound runner hook. No process/config mutation and no source-env expansion. */
export async function createNativeCodingAgentMcpLaunch({registration,nodeExecutable,nodeSha256,entrypointPath,bridgeSha256,
  shellEnvironmentExcludes=[]}={}){
  const scope=validateNativeCodingAgentMcpBinding(registration?.binding);
  if(typeof registration.endpoint!=='string'||!SHA.test(registration.capability||'')||!Array.isArray(registration.allowedTools)
    ||!registration.allowedTools.length||new Set(registration.allowedTools).size!==registration.allowedTools.length
    ||registration.allowedTools.some(name=>!NATIVE_AGENT_MCP_TOOLS.includes(name))
    ||!Array.isArray(shellEnvironmentExcludes)||shellEnvironmentExcludes.some(value=>typeof value!=='string'||value.length>200||/[\x00-\x1f]/.test(value))
    ||!bridgeSha256||Object.keys(bridgeSha256).sort().join(',')!=='adapter,broker,entrypoint')fail();
  const directory=path.dirname(entrypointPath||'');
  if(path.basename(entrypointPath||'')!=='native-coding-agent-mcp-entry.mjs')fail();
  await pinnedFile(nodeExecutable,nodeSha256,512*1024*1024);
  await pinnedFile(entrypointPath,bridgeSha256.entrypoint,256*1024);
  await pinnedFile(path.join(directory,'native-coding-agent-mcp-broker.mjs'),bridgeSha256.broker,256*1024);
  await pinnedFile(path.join(directory,'native-coding-agent-mcp-stdio.mjs'),bridgeSha256.adapter,256*1024);
  const names=Object.values(NATIVE_AGENT_MCP_ENV),capability=registration.capability,endpoint=registration.endpoint;
  const excludes=[...new Set([...shellEnvironmentExcludes,'METAENGINE_NATIVE_MCP_*'])];
  const configuration='{command='+quote(nodeExecutable)+',args=['+quote(entrypointPath)+'],cwd='+quote(directory)
    +',env_vars=['+names.map(quote).join(',')+'],enabled_tools=['+registration.allowedTools.map(quote).join(',')
    +'],required=true,startup_timeout_sec=10,tool_timeout_sec=70}';
  const argv=Object.freeze(['-c','mcp_servers.metaengine='+configuration,'-c','shell_environment_policy.exclude=['+excludes.map(quote).join(',')+']']);
  const launch=Object.freeze({argv,metadata:Object.freeze({schema:'metaengine.native-coding.agent-mcp-launch.v1',run_id:scope.run_id,
    allowed_tools:Object.freeze([...registration.allowedTools]),node_sha256:nodeSha256,bridge_sha256:Object.freeze({...bridgeSha256}),
    capability_in_argv:false,global_config_modified:false,authority_effect:false}),
    createEnvironment(baseEnvironment){
      if(!baseEnvironment||Object.getPrototypeOf(baseEnvironment)!==Object.prototype
        ||Object.entries(baseEnvironment).some(([key,value])=>typeof value!=='string'||/^METAENGINE_NATIVE_MCP_/i.test(key)))fail();
      return Object.freeze({...baseEnvironment,[NATIVE_AGENT_MCP_ENV.endpoint]:endpoint,[NATIVE_AGENT_MCP_ENV.capability]:capability});
    }
  });
  verifiedLaunches.add(launch);return launch;
}
