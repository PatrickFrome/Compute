const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const toolsRoot = path.join(__dirname, 'build-tools');
const appBuilderRoot = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [toolsRoot] }));
const { getFileMatchers, copyFiles } = require(path.join(appBuilderRoot, 'out', 'fileMatcher.js'));
const builderVersion = JSON.parse(readFileSync(path.join(appBuilderRoot, 'package.json'), 'utf8')).version;
assert.equal(builderVersion, '26.15.7', 'unexpected_app_builder_lib_version');

const configPath = path.resolve(__dirname, '..', 'electron-builder.test.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const sets = config.extraResources.filter(item => typeof item === 'object' && item.from?.startsWith('me2-ui-dist'));
assert.deepEqual(sets.map(item => [item.from, item.to]), [
  ['me2-ui-dist', 'me2-ui'],
  ['me2-ui-dist/node_modules', 'me2-ui/node_modules'],
], 'me2_ui_fileset_contract_invalid');

const root = mkdtempSync(path.join(process.env.RUNNER_TEMP || require('node:os').tmpdir(), 'me2-builder-copy-'));
const source = path.join(root, 'app');
const dep = path.join(source, 'me2-ui-dist', 'node_modules', 'next', 'package.json');
mkdirSync(path.dirname(dep), { recursive: true });
writeFileSync(dep, '{"name":"next"}');
writeFileSync(path.join(source, 'me2-ui-dist', 'server.js'), 'require("next");');

async function copy(label, rules) {
  const destination = path.join(root, label);
  const matchers = getFileMatchers({ extraResources: rules }, 'extraResources', destination, {
    defaultSrc: source,
    macroExpander: value => value,
    customBuildOptions: {},
    globalOutDir: path.join(root, 'out'),
  });
  await copyFiles(matchers, null, false);
  return {
    server: existsSync(path.join(destination, 'me2-ui', 'server.js')),
    dependency: existsSync(path.join(destination, 'me2-ui', 'node_modules', 'next', 'package.json')),
  };
}

(async () => {
  try {
    const before = await copy('before', sets.slice(0, 1));
    const after = await copy('after', sets);
    assert.deepEqual(before, { server: true, dependency: false }, 'must_reproduce_r77_missing_root_node_modules');
    assert.deepEqual(after, { server: true, dependency: true }, 'fixed_filesets_must_retain_ui_dependencies');
    console.log(JSON.stringify({
      schema: 'metaengine.browser.me2.builder-copy-proof.v1',
      app_builder_lib: builderVersion,
      before_dependency_present: before.dependency,
      after_dependency_present: after.dependency,
      result: 'PASS',
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(`ME2_BUILDER_COPY_VERIFICATION_FAILED: ${error.message}`);
  process.exitCode = 1;
});
