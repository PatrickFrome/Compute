import os from 'node:os';

// Resource admission controls only a physical start. It never limits the
// durable agent registry, project queue or cumulative number of agent runs.
export function readAgentResourceAdmission({freeMemory=os.freemem(),totalMemory=os.totalmem(),
  parallelism=os.availableParallelism(),memoryPerWorker=256*1024*1024}={}) {
  if (![freeMemory,totalMemory,parallelism,memoryPerWorker].every(Number.isSafeInteger)
    ||freeMemory<0||totalMemory<1||parallelism<1||memoryPerWorker<1)
    throw Error('agent_resource_observation_invalid');
  const reserve=Math.min(256*1024*1024,Math.ceil(totalMemory/32));
  const memoryHeadroom=Math.max(0,Math.floor((freeMemory-reserve)/memoryPerWorker));
  return Object.freeze({schema:'metaengine.agent-resource-admission.v1',agent_count_limit:null,
    physical_start_allowed:memoryHeadroom>0,memory_headroom:memoryHeadroom,
    physical_parallelism:Math.min(parallelism,memoryHeadroom),
    free_memory_bytes:freeMemory,reserved_memory_bytes:reserve,authority_effect:false});
}

export function defaultNativePhysicalSlotBudget() {
  // A zero-capacity observation delays starts; the retained pool still needs
  // a positive capacity to represent its receipts and observe future recovery.
  return Math.max(1,readAgentResourceAdmission().physical_parallelism);
}
