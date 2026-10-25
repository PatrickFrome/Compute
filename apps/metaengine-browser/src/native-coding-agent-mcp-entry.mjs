import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {connectNativeCodingAgentMcpBroker} from './native-coding-agent-mcp-broker.mjs';
import {createNativeCodingAgentMcpStdioAdapter} from './native-coding-agent-mcp-stdio.mjs';

export const NATIVE_AGENT_MCP_ENV=Object.freeze({endpoint:'METAENGINE_NATIVE_MCP_ENDPOINT',capability:'METAENGINE_NATIVE_MCP_CAPABILITY'});

/** Entrypoint authority is the private Host capability, never argv or MCP client metadata. */
export async function startNativeCodingAgentMcpStdio({environment=process.env,input=process.stdin,output=process.stdout}={}){
  const endpoint=environment[NATIVE_AGENT_MCP_ENV.endpoint],capability=environment[NATIVE_AGENT_MCP_ENV.capability];
  // No child is launched here. Remove the bootstrap capability from this process's
  // inherited environment after taking the private local copy.
  delete environment[NATIVE_AGENT_MCP_ENV.endpoint];delete environment[NATIVE_AGENT_MCP_ENV.capability];
  const client=await connectNativeCodingAgentMcpBroker({endpoint,capability});
  const operations=Object.fromEntries(client.allowedTools.map(name=>[name,(args,context)=>client.invoke(name,args,{signal:context.signal})]));
  const adapter=createNativeCodingAgentMcpStdioAdapter({binding:client.binding,allowedTools:client.allowedTools,operations,input,output,
    writeIntentAuthority:'PRIVATE_HOST_BROKER',
    // The broker re-resolves its private registry and asserts actual current lease
    // and native Job on every invocation. This local check only fences disconnect.
    assertInvocationAuthorized:()=>{if(client.snapshot().closed)throw Error('native_agent_bridge_closed');},
    timeoutMs:Math.min(68000,client.timeoutMs+3000)});
  let closed=false;
  const close=()=>{if(closed)return;closed=true;adapter.close();client.close();input.off('end',close);input.off('error',close);};
  input.once('end',close);input.once('error',close);void client.completion.then(close);
  return Object.freeze({close,completion:client.completion,snapshot:()=>({closed,adapter:adapter.snapshot(),authority_effect:false})});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2){process.stderr.write('METAENGINE native tools unavailable\n');process.exitCode=1;}
  else{
    try{const service=await startNativeCodingAgentMcpStdio();
      void service.completion.then(()=>{process.stdin.destroy();});
      for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{service.close();process.stdin.destroy();});
    }catch{process.stderr.write('METAENGINE native tools unavailable\n');process.exitCode=1;process.stdin.destroy();}
  }
}
