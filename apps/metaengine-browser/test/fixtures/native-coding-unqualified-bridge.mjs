import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNativeCodingAgentMcpBroker,nativeCodingAgentMcpIntentBodySha256} from '../../src/native-coding-agent-mcp-broker.mjs';
import {createNativeCodingAgentMcpLaunch} from '../../src/native-coding-agent-mcp-launch.mjs';
import {validateNativeCodingAgentHostRequest} from '../../src/native-coding-agent-host-contract.mjs';
import {nativeCodingCanonicalJson} from '../../src/native-coding-task-context.mjs';
// Counterfactual UNDERLYING lifecycle tests only. The real default bridge is
// blocked by DIRECTORY_DURABILITY_UNQUALIFIED. No production override exists.
const source=await fs.readFile(new URL('../../src/native-coding-agent-run-bridge.mjs',import.meta.url),'utf8');
export const prepareUnqualifiedBridgeFixture=new Function('requireNativeRunCallbackPublication','createHash','createNativeCodingAgentMcpBroker',
 'nativeCodingAgentMcpIntentBodySha256','createNativeCodingAgentMcpLaunch','validateNativeCodingAgentHostRequest','canonical',
 source.replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')+'\nreturn prepareNativeCodingAgentRunBridge;')
 (()=>{},createHash,createNativeCodingAgentMcpBroker,nativeCodingAgentMcpIntentBodySha256,createNativeCodingAgentMcpLaunch,validateNativeCodingAgentHostRequest,nativeCodingCanonicalJson);
