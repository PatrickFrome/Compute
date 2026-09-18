"use strict";

// Production compatibility-pack verification remains disabled until a public
// signing root is provisioned in the packaged extension. Never place the
// corresponding private key in the repository or extension package.
globalThis.A2_COMPAT_ROOT_JWK = globalThis.A2_COMPAT_ROOT_JWK || null;
