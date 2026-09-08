import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourcePath = '.github/scripts/dark-workspace-v2-patch.mjs';
const runtimePath = '.github/scripts/dark-workspace-v2-patch-runtime.mjs';
let source = await fs.readFile(sourcePath, 'utf8');
const before = "html = exact(html, 'data-final-shell=\"telegram-browser-v1\"', 'data-final-shell=\"metaengine-dark-workspace-v2\"', 'html_shell_contract');";
const after = "html = exact(html, '<body data-sidebar=\"EXPANDED\" data-operations=\"CLOSED\" data-final-shell=\"telegram-browser-v1\">', '<body data-sidebar=\"EXPANDED\" data-operations=\"CLOSED\" data-final-shell=\"metaengine-dark-workspace-v2\">', 'html_shell_contract');";
if ((source.split(before).length - 1) !== 1) throw new Error('dark_workspace_runner_anchor_invalid');
source = source.replace(before, after);
await fs.writeFile(runtimePath, source);
try {
  await import(pathToFileURL(path.resolve(runtimePath)).href);
} finally {
  await fs.rm(runtimePath, { force: true });
}
