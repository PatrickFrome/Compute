'use strict';

// W40: lockfile-anchored, complete REQUIRED runtime transitive closure.
// Source-only check: no npm install, registry write, signing or effect authority.
const crypto = require('node:crypto');
const SHA40 = /^[a-f0-9]{40}$/;
function fail(code) { throw new Error('client_package_w40_' + code); }
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function isRecord(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function depPath(parent, dep, packages) {
  if (!/^(?:@[^/]+\/)?[^/]+$/.test(dep) || dep.includes('..')) fail('dependency_name_invalid');
  let base = parent;
  for (;;) {
    const candidate = (base ? base + '/' : '') + 'node_modules/' + dep;
    if (own(packages,candidate)) return candidate;
    if (!base) break;
    const next = base.replace(/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/, '');
    if (next === base) fail('package_path_invalid');
    base = next;
  }
  fail('transitive_lock_missing');
}
function requiredDeps(pkg) {
  if (pkg.dependencies !== undefined && !isRecord(pkg.dependencies)) fail('lock_dependencies_invalid');
  if (pkg.peerDependencies !== undefined && !isRecord(pkg.peerDependencies)) fail('lock_peers_invalid');
  const out = Object.assign(Object.create(null),pkg.dependencies || {});
  for (const [name, range] of Object.entries(pkg.peerDependencies || {})) {
    if (pkg.peerDependenciesMeta?.[name]?.optional === true) continue;
    if (!own(out,name)) out[name]=range;
  }
  return out;
}
function assertRuntimeLockClosure({ manifest, identity, installed, packageLockBytes, expectedSourceHead }) {
  if (typeof expectedSourceHead !== 'string' || !SHA40.test(expectedSourceHead)) fail('expected_source_missing');
  if (identity.source_head !== expectedSourceHead) fail('source_head_drift');
  if (!Buffer.isBuffer(packageLockBytes) || packageLockBytes.length < 32) fail('lock_bytes_missing');
  const lockHash = crypto.createHash('sha256').update(packageLockBytes).digest('hex');
  if (lockHash !== identity.package_lock_sha256) fail('lock_digest_drift');
  let lock;
  try { lock = JSON.parse(packageLockBytes.toString('utf8')); } catch { fail('lock_invalid'); }
  if (!isRecord(lock) || lock.lockfileVersion !== 3 || !isRecord(lock.packages)) fail('lock_invalid');
  const root = lock.packages[''];
  if (!isRecord(root) || root.name !== manifest.name || root.version !== manifest.version ||
      lock.name !== manifest.name || lock.version !== manifest.version) fail('lock_root_drift');
  if (JSON.stringify(Object.entries(root.dependencies || {}).sort()) !==
      JSON.stringify(Object.entries(manifest.dependencies || {}).sort())) fail('lock_manifest_dependency_drift');
  const resolved = new Set();
  const pending = [{ key: '', pkg: root, installedNode: installed.tree }];
  const requiredInstalled = new Set();
  let count = 0;
  while (pending.length) {
    const {key,pkg,installedNode} = pending.pop();
    if (resolved.has(key)) continue;
    resolved.add(key);
    if (++count > 8192) fail('lock_too_large');
    for (const [name] of Object.entries(requiredDeps(pkg))) {
      const childPath = depPath(key,name,lock.packages);
      const child=lock.packages[childPath];
      if (!isRecord(child) || typeof child.version !== 'string' || !child.version) fail('transitive_lock_invalid');
      // Reject source/link placeholders: an executable must include actual pinned installed bytes.
      if (child.link === true || child.dev === true && !child.devOptional) fail('transitive_lock_not_runtime');
      const actualChild=installedNode.dependencies[name];
      if (!isRecord(actualChild) || actualChild.name !== name || actualChild.version !== child.version) {
        fail('runtime_transitive_dependency_missing');
      }
      requiredInstalled.add(name + '@' + child.version);
      pending.push({key:childPath,pkg:child,installedNode:actualChild});
    }
  }
  // Compare EACH logical edge to the independently lock-resolved branch.
  // Merely finding the package elsewhere (e.g. under a dev dependency) is insufficient.
  return Object.freeze({
    lock_sha256:lockHash, required_runtime_resolutions:requiredInstalled.size,
    source_head:expectedSourceHead, authority_effect:false,
    installed_runtime_verified:false, promotion_authorized:false,
  });
}
module.exports=Object.freeze({assertRuntimeLockClosure});
