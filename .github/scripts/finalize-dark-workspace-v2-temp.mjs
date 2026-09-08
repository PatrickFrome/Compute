import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const files = {
  html: 'apps/metaengine-browser/ui/index.html',
  brain: 'apps/metaengine-browser/test/browser-brain-task-first-ui.test.mjs',
  devos: 'apps/metaengine-browser/test/browser-devos-shell-ui.test.mjs',
  legacy: 'apps/metaengine-browser/test/browser-shell-telegram-brain-v2.test.mjs',
};

function replaceExact(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}:expected_one_match:got_${count}`);
  return source.replace(before, after);
}

let html = await readFile(files.html, 'utf8');
const inline = html.match(/<script data-adaptive-context-rail>([\s\S]*?)<\/script>/)?.[1];
if (!inline) throw new Error('adaptive_script_missing');
const digest = createHash('sha256').update(inline, 'utf8').digest('base64');
html = html.replace(/script-src 'self' 'sha256-[^']+'/,
  `script-src 'self' 'sha256-${digest}'`);
if (!html.includes(`script-src 'self' 'sha256-${digest}'`)) throw new Error('csp_digest_not_applied');
await writeFile(files.html, html);

let brain = await readFile(files.brain, 'utf8');
brain = replaceExact(
  brain,
  "  assert.match(source, /Sessions & Agents/);\n  assert.match(source, /Search sessions, agents, workspaces/);",
  "  assert.match(html, /<strong>Workspace<\\/strong>/);\n  assert.match(html, /placeholder=\"Search BrowserCells\"/);",
  'brain_workspace_contract',
);
await writeFile(files.brain, brain);

let devos = await readFile(files.devos, 'utf8');
devos = replaceExact(
  devos,
  "  assert.equal((html.match(/<style\\b/g) || []).length, 1);\n  assert.match(html, /data-adaptive-context-rail/);",
  "  assert.equal((html.match(/<style\\b/g) || []).length, 0);\n  assert.match(html, /<link rel=\"stylesheet\" href=\"metaengine:\\/\\/shell\\/dark-workspace\\.css\">/);\n  assert.match(html, /data-adaptive-context-rail/);",
  'devos_external_style_contract',
);
await writeFile(files.devos, devos);

let legacy = await readFile(files.legacy, 'utf8');
legacy = replaceExact(
  legacy,
  "const css = fs.readFileSync(path.join(appRoot, 'ui', 'app.css'), 'utf8');\nconst renderer = fs.readFileSync(path.join(appRoot, 'ui', 'app.js'), 'utf8');",
  "const css = fs.readFileSync(path.join(appRoot, 'ui', 'app.css'), 'utf8');\nconst darkCss = fs.readFileSync(path.join(appRoot, 'ui', 'dark-workspace.css'), 'utf8');\nconst renderer = fs.readFileSync(path.join(appRoot, 'ui', 'app.js'), 'utf8');",
  'legacy_dark_css_read',
);
legacy = replaceExact(legacy, "test('Brain Shell V4 protects page space and keeps Brain closed until requested'", "test('Dark Workspace V2 protects page space and keeps Brain closed until requested'", 'legacy_test_name_1');
legacy = replaceExact(legacy, '  assert.equal(SHELL_TOP_HEIGHT, 48);', '  assert.equal(SHELL_TOP_HEIGHT, 44);', 'top_height');
legacy = replaceExact(legacy, '  assert.equal(SHELL_SIDEBAR_EXPANDED_WIDTH, 272);', '  assert.equal(SHELL_SIDEBAR_EXPANDED_WIDTH, 240);', 'expanded_width');
legacy = replaceExact(legacy, '  assert.equal(SHELL_SIDEBAR_COMPACT_WIDTH, 56);', '  assert.equal(SHELL_SIDEBAR_COMPACT_WIDTH, 52);', 'compact_width');
legacy = replaceExact(legacy, '  assert.equal(SHELL_OPERATIONS_WIDTH, 352);', '  assert.equal(SHELL_OPERATIONS_WIDTH, 320);', 'ops_width');
legacy = replaceExact(legacy, '  assert.equal(calm.remote_bounds.y, 48);', '  assert.equal(calm.remote_bounds.y, 44);', 'remote_y');
legacy = replaceExact(legacy, '  assert.equal(calm.remote_bounds.x, 272);', '  assert.equal(calm.remote_bounds.x, 240);', 'remote_x');
legacy = replaceExact(legacy, '  assert.equal(inspector.operations_bounds.width, 352);', '  assert.equal(inspector.operations_bounds.width, 320);', 'inspector_width');
legacy = replaceExact(legacy, "test('Brain Shell V4 is light, chat-first and deliberately low-noise'", "test('Dark Workspace V2 is dark, browser-first and deliberately low-noise'", 'legacy_test_name_2');
legacy = replaceExact(legacy, '  assert.match(html, /color-scheme" content="light"/);', '  assert.match(html, /color-scheme" content="dark"/);', 'color_scheme');
legacy = replaceExact(legacy, '  assert.match(html, /data-final-shell="telegram-browser-v1"/);', '  assert.match(html, /data-final-shell="metaengine-dark-workspace-v2"/);', 'shell_contract');
legacy = replaceExact(
  legacy,
  "  assert.match(css, /color-scheme:light/);\n  assert.match(css, /--top-height:48px/);\n  assert.match(css, /--sidebar-width:272px/);\n  assert.match(css, /--ops-width:352px/);\n  assert.match(css, /border-radius:18px/);",
  "  assert.match(darkCss, /color-scheme:dark/);\n  assert.match(darkCss, /--top-height:44px/);\n  assert.match(darkCss, /--sidebar-width:240px/);\n  assert.match(darkCss, /--ops-width:320px/);\n  assert.match(darkCss, /background:var\\(--bg\\)/);\n  assert.doesNotMatch(darkCss, /telegram-browser-v1/i);",
  'dark_css_tokens',
);
legacy = legacy.replaceAll('Brain Shell V4', 'Dark Workspace V2');
await writeFile(files.legacy, legacy);

console.log(JSON.stringify({
  schema: 'metaengine.browser.dark-workspace-finalizer.v1',
  csp_sha256: digest,
  files: Object.values(files),
  authority_effect: false,
}));
