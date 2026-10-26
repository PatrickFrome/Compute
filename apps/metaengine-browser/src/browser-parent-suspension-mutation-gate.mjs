import { AsyncLocalStorage } from 'node:async_hooks';

// One private main-process gate, composed with the existing mutation boundary.
// It creates neither authority nor a queue: busy acquisitions fail before any
// checkpoint/DB effect. Policy/stop commands remain outside this physical gate.
export function createBrowserParentSuspensionMutationGate() {
  const context = new AsyncLocalStorage();
  let owner = null;
  let physicalMutations = 0;
  return Object.freeze({
    async mutation(operation) {
      if (typeof operation !== 'function') throw new Error('parent_suspension_mutation_operation_required');
      if (owner && context.getStore() !== owner) throw new Error('parent_suspension_physical_mutation_fenced');
      physicalMutations++;
      try { return await operation(); }
      finally { physicalMutations--; }
    },
    async exclusive(operation) {
      if (typeof operation !== 'function') throw new Error('parent_suspension_exclusive_operation_required');
      if (owner || physicalMutations !== 0) throw new Error('parent_suspension_physical_mutation_busy');
      const token = Object.freeze({}); owner = token;
      try { return await context.run(token, operation); }
      finally { if (owner === token) owner = null; }
    },
    owned() { return owner !== null && context.getStore() === owner; },
    snapshot() {
      return Object.freeze({ held: owner !== null, physical_mutations: physicalMutations, authority_effect: false });
    },
  });
}
