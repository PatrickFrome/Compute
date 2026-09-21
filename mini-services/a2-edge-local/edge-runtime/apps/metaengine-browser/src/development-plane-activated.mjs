import { DevelopmentPlane as ProvenDevelopmentPlane } from './development-plane.mjs';
import {
  registerFinalRuntimeDevelopmentPlane,
  unregisterFinalRuntimeDevelopmentPlane,
} from './final-runtime-activation-registry.mjs';

export * from './development-plane.mjs';

export class DevelopmentPlane extends ProvenDevelopmentPlane {
  constructor(options = {}) {
    super(options);
    registerFinalRuntimeDevelopmentPlane(this);
  }

  stop() {
    unregisterFinalRuntimeDevelopmentPlane(this);
    return super.stop();
  }

  async stopAndWait(...args) {
    unregisterFinalRuntimeDevelopmentPlane(this);
    return super.stopAndWait(...args);
  }
}
