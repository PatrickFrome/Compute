
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { handleFetch, handleQueue } from './handlers.js';
import { runFabricWorkflow } from './workflow.js';

export class FabricWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    return await runFabricWorkflow(this.env, event, step, null);
  }
}

export default {
  async fetch(request, env) {
    return await handleFetch(request, env);
  },
  async queue(batch, env) {
    await handleQueue(batch, env);
  },
};
