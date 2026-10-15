import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const workflow=fs.readFileSync(fileURLToPath(new URL('../../../.github/workflows/browser-windows-package-smoke.yml',import.meta.url)),'utf8');

test('immutable candidate archive isolates Guardian Bootstrap from its one NSIS EXE',()=>{
 assert.match(workflow,/\$guardianArtifactDir = Join-Path \$env:RUNNER_TEMP 'guardian-bootstrap'/);
 assert.match(workflow,/Copy-Item \(Join-Path \$bootstrapDir 'METAENGINE-Guardian-Bootstrap-\*-x64\.exe'\) \$guardianArtifactDir/);
 assert.match(workflow,/runner\.temp \}\}\/guardian-bootstrap\/METAENGINE-Guardian-Bootstrap-\*-x64\.exe/);
 assert.doesNotMatch(workflow,/Copy-Item \(Join-Path \$bootstrapDir 'METAENGINE-Guardian-Bootstrap-\*-x64\.exe'\) \$env:RUNNER_TEMP/);
});
