import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const rel = 'apps/metaengine-browser/test/browser-guardian-native-staging-contract.test.mjs';
const file = path.join(root, rel);
let text = await fs.readFile(file, 'utf8');

const from = `  assert.deepEqual(builder.extraResources, [{\n    from: 'native-dist/guardian',\n    to: 'guardian-native',\n    filter: ['**/*'],\n  }]);`;
const to = `  assert.deepEqual(builder.extraResources, [{\n    from: 'native-dist/guardian',\n    to: 'guardian-native',\n    filter: ['**/*'],\n  }, {\n    from: 'devos-source-snapshot',\n    to: 'devos-source-snapshot',\n    filter: ['**/*'],\n  }]);\n  assert.match(hook, /buildDevOSSourceSnapshot/);\n  assert.match(hook, /devos-source-snapshot/);`;

const first = text.indexOf(from);
if (first < 0) throw new Error('guardian_extra_resources_contract_anchor_missing');
if (text.indexOf(from, first + from.length) >= 0) throw new Error('guardian_extra_resources_contract_anchor_ambiguous');
text = text.slice(0, first) + to + text.slice(first + from.length);
await fs.writeFile(file, text, 'utf8');
console.log(JSON.stringify({ schema: 'metaengine.devos.convergence-contract-patch.v1', ok: true }));
