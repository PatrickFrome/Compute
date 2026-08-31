import {
  FleetProvisioner as CoreFleetProvisioner,
  FLEET_PROFILES,
  FLEET_PROVISIONER_VERSION,
  FLEET_STATES,
} from './fleet-provisioner-core.mjs';
import { registerFleetRuntime } from './fleet-runtime-bridge.mjs';

export { FLEET_PROFILES, FLEET_PROVISIONER_VERSION, FLEET_STATES };

export class FleetProvisioner extends CoreFleetProvisioner {
  async init(...args) {
    const snapshot = await super.init(...args);
    registerFleetRuntime(this);
    return snapshot;
  }
}
