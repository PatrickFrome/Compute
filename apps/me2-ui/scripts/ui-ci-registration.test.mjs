import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const workflow=fs.readFileSync(new URL('../../../.github/workflows/metaengine-client-w23-me2-typecheck.yml',import.meta.url),'utf8');
test('UI qualification covers integration pushes and pins both push and PR source identity',()=>{
 assert.match(workflow,/push:\s+branches:\s+- 'work\/chat-cli-critic-integration-20261029'/);
 assert.match(workflow,/pull_request:\s+paths:/);
 assert.match(workflow,/ME2_BUILD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
 assert.match(workflow,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
 assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/contents: read/);
 assert.match(workflow,/test "\$\(git rev-parse HEAD\)" = "\$ME2_BUILD_SHA"/);
 for(const script of ['test:operator-observatory','lint','typecheck','test:goal-admission','test:project-history','test:recovery','build','pack'])assert.ok(workflow.includes('run: bun run '+script),script);
 assert.match(workflow,/bun install --frozen-lockfile/);assert.match(workflow,/m\.git_sha!==process\.env\.ME2_BUILD_SHA/);
});


test('UI qualification retains actual browser acceptance, source immutability and evidence',()=>{
 assert.match(workflow,/node-version: '24\.21\.0'/);
 assert.match(workflow,/playwright@1\.62\.1/);
 assert.match(workflow,/node apps\/me2-ui\/scripts\/ui-source-acceptance\.mjs --root/);
 assert.match(workflow,/--expected-sha "\$ME2_BUILD_SHA"/);
 assert.match(workflow,/git diff --exit-code/);assert.match(workflow,/git diff --cached --exit-code/);
 assert.match(workflow,/source-acceptance\.json/);assert.match(workflow,/renderer-\*\.png/);
 assert.match(workflow,/if-no-files-found: error/);
});
