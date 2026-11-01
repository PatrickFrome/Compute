import { createRequire } from 'node:module';
import { isMainThread } from 'node:worker_threads';
import { readVerifiedInstalledExecutableW68 } from './installed-executable-provenance-w68.mjs';

const require = createRequire(import.meta.url);
const unavailable = reason => Object.assign(new Error(reason), { code: reason });

// The caller cannot provide a module path, HANDLE, PID, expected hash, transport,
// source proof or verifier callback. The C++ module opens the fixed pipe INSIDE
// the actual native Main process. A sidecar connection is a different principal.
export async function openGuardianConnectedPeerNative(...args) {
  if (args.length) throw unavailable('GUARDIAN_CONNECTED_PEER_OPTIONS_FORBIDDEN');
  if (process.platform !== 'win32' || !process.versions.electron || process.type !== 'browser' || !isMainThread)
    throw unavailable('GUARDIAN_CONNECTED_PEER_PACKAGED_MAIN_REQUIRED');
  let app;
  try { ({ app } = require('electron')); }
  catch { throw unavailable('GUARDIAN_CONNECTED_PEER_PACKAGED_MAIN_REQUIRED'); }
  if (app?.isPackaged !== true) throw unavailable('GUARDIAN_CONNECTED_PEER_PACKAGED_MAIN_REQUIRED');

  // Existing W68 authenticates the entire physical package inventory, including
  // this exact native module. It is a prerequisite to loading new native bytes,
  // not a peer receipt, loaded-code attestation or launch permission.
  let source;
  try { source = await readVerifiedInstalledExecutableW68(app); }
  catch { throw unavailable('GUARDIAN_CONNECTED_PEER_PACKAGE_PROVENANCE_UNAVAILABLE'); }
  if (!source || source.source !== 'INSTALLED_EXE_NATIVE_VERIFIER' || source.release_root_signature_verified !== true ||
      source.package_code_verified !== true || source.exact_bytes_verified !== true || source.native_signature_verified !== true ||
      source.authority_effect !== false || source.loaded_runtime_code_attested !== false ||
      source.fixture_classification != null || source.staging === true || source.synthetic === true || source.untrusted === true)
    throw unavailable('GUARDIAN_CONNECTED_PEER_PACKAGE_PROVENANCE_UNAVAILABLE');
  // W68 + lstat/realpath is only an on-disk observation. It cannot retain
  // deny-write/delete custody across loading a native DLL from writable
  // LocalAppData. Loading first and returning native HOLD afterwards is too late.
  // The existing native machine bootstrap must provide an immutable retained
  // module-load producer before this path can require the fixed native artifact.
  // No caller path, callback, JSON flag or environment switch can supply it.
  throw unavailable('GUARDIAN_CONNECTED_PEER_NATIVE_LOAD_CUSTODY_UNAVAILABLE');
}
