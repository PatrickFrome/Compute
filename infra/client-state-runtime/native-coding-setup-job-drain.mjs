// Consumer-only seam. The private issuer and live-job registry remain inside
// the actual setup service; no JSON data or public factory can mint a token.
// Ownership of a joined setup job grants no native/full-scope qualification.
export {consumeNativeSetupJobDrain} from './native-coding-host-setup-service.mjs';
