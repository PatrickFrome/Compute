import fs from 'node:fs/promises';

const file = 'apps/metaengine-browser/test/browser-final-shell-ui.test.mjs';
let source = await fs.readFile(file, 'utf8');
const before = "  assert.match(dark, /background:#090c11/);";
const after = "  assert.match(dark, /--bg:#090c11/);";
if ((source.split(before).length - 1) !== 1) throw new Error('dark_bg_token_assertion_anchor_invalid');
source = source.replace(before, after);
await fs.writeFile(file, source);
console.log(JSON.stringify({ ok: true, schema: 'metaengine.browser.dark-workspace-v2-finalize.v1' }));
