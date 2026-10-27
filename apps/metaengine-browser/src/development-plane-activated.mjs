import { DevelopmentPlane as ProvenDevelopmentPlane } from './development-plane.mjs';
import {
  registerFinalRuntimeDevelopmentPlane,
  resumeFinalRuntimeDevelopmentPlane,
  unregisterFinalRuntimeDevelopmentPlane,
} from './final-runtime-activation-registry.mjs';

export * from './development-plane.mjs';

export class DevelopmentPlane extends ProvenDevelopmentPlane {
  #registrationGeneration = 0;

  constructor(options = {}) {
    super(options);
    registerFinalRuntimeDevelopmentPlane(this);
  }

  async start() {
    const generation = this.#registrationGeneration;
    const result = await super.start();
    // main reuses this instance after unexpected-window recovery. Rejoin the
    // activation registry only after readiness, and never after a newer stop
    // or after another instance has claimed the registry's ownership slot.
    if (generation === this.#registrationGeneration && this.snapshot().state === 'READY') {
      resumeFinalRuntimeDevelopmentPlane(this);
    }
    return result;
  }

  stop() {
    this.#registrationGeneration += 1;
    unregisterFinalRuntimeDevelopmentPlane(this);
    return super.stop();
  }

  async stopAndWait(...args) {
    this.#registrationGeneration += 1;
    unregisterFinalRuntimeDevelopmentPlane(this);
    return super.stopAndWait(...args);
  }
}
