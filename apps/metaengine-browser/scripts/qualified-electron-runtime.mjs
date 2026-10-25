import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const browserRoot = fileURLToPath(new URL('../', import.meta.url));
const fail = reason => { throw new Error('qualification_electron_' + reason); };
const sourceOverrides = new Set(['overridedistpath', 'mirror', 'nightlymirror', 'customdir', 'customfilename',
  'customversion', 'skipbinarydownload', 'checksums', 'useremotechecksums', 'installplatform', 'installarch']);
const overridesSource = key => {
  const prefix = /^(?:npm_package_config_|npm_config_)?electron_/;
  if (!prefix.test(key.toLowerCase())) return false;
  const suffix = key.toLowerCase().replace(prefix, '');
  return sourceOverrides.has(suffix.replaceAll('_', ''));
};

// The locked package owns download, checksum verification and platform layout.
// Tests resolve it only after CI has explicitly provisioned it outside their
// native deadlines; never synthesize a CWD-relative dist/electron.exe path.
export function resolveQualifiedElectron({ materialize = false, root = browserRoot, environment = process.env } = {}) {
  if (Object.entries(environment).some(([key, value]) => overridesSource(key) && value)
      || (environment.npm_config_platform && environment.npm_config_platform !== process.platform)
      || (environment.npm_config_arch && environment.npm_config_arch !== process.arch)) fail('source_override_forbidden');
  const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
  const manifest = readJson(path.join(root, 'package.json'));
  const lock = readJson(path.join(root, 'package-lock.json'));
  const locked = lock.packages?.['node_modules/electron'];
  const require = createRequire(path.join(root, 'package.json'));
  const packagePath = require.resolve('electron/package.json');
  const packageRoot = path.dirname(packagePath);
  const installed = readJson(packagePath);
  if (manifest.devDependencies?.electron !== '44.0.0' || locked?.version !== '44.0.0'
      || locked.resolved !== 'https://registry.npmjs.org/electron/-/electron-44.0.0.tgz'
      || installed.version !== locked.version || !/^sha512-[A-Za-z0-9+/]+=*$/.test(locked.integrity || '')) fail('locked_version_invalid');
  const dist = path.join(packageRoot, 'dist');
  const resolveInstalled = () => {
    const relative = fs.readFileSync(path.join(packageRoot, 'path.txt'), 'utf8');
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail('path_invalid');
    const binary = path.resolve(dist, relative);
    if (!binary.startsWith(path.resolve(dist) + path.sep)) fail('path_invalid');
    return binary;
  };
  if (!materialize) {
    try {
      if (!fs.statSync(resolveInstalled()).isFile()) fail('binary_not_materialized');
    } catch (error) {
      if (error.code === 'ENOENT') fail('binary_not_materialized_run_prerequisite');
      throw error;
    }
  }
  // Electron 44's documented package resolver lazily invokes its own installer.
  const executable = require('electron');
  if (typeof executable !== 'string' || path.resolve(executable) !== resolveInstalled()) fail('resolver_path_mismatch');
  const realExecutable = fs.realpathSync(executable);
  const realDist = fs.realpathSync(dist);
  if (!realExecutable.startsWith(realDist + path.sep) || !fs.statSync(realExecutable).isFile()) fail('binary_unavailable');
  return { executable: realExecutable, package_version: installed.version,
    binary_sha256: createHash('sha256').update(fs.readFileSync(realExecutable)).digest('hex') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out' || !path.isAbsolute(args[1])) fail('arguments_invalid');
  const runtime = resolveQualifiedElectron({ materialize: true });
  const receipt = { schema: 'metaengine.browser.qualified-electron-runtime.v1', ...runtime, authority_effect: false };
  fs.writeFileSync(args[1], JSON.stringify(receipt) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(receipt));
}
