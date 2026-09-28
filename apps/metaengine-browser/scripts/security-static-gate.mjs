import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECURITY_STATIC_GATE_SCHEMA = 'metaengine.browser.security-static-gate.v1';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_ROOTS = Object.freeze(['src', 'ui', path.join('smoke', 'dp')]);
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.html', '.css']);

const PRODUCTION_ESCAPE_RULES = Object.freeze([
  Object.freeze({ id: 'EXECUTE_JAVASCRIPT', pattern: /executeJavaScript/ }),
  Object.freeze({ id: 'RUNTIME_EVALUATE', pattern: /Runtime\.evaluate/ }),
  Object.freeze({ id: 'REMOTE_DEBUGGING_PORT', pattern: /--remote-debugging-port/ }),
  Object.freeze({ id: 'NO_SANDBOX_SWITCH', pattern: /--no-sandbox/ }),
  // Operator directive 2026-09-19: every browser agent runs on GLM 5.3
  // (chat.z.ai, platform GLM_ZAI) instead of ChatGPT. The former LEGACY_CHAT_Z_AI
  // and LEGACY_GLM_ZAI prohibitions are inverted — chat.z.ai/GLM_ZAI are now the
  // sanctioned agent-platform identifiers and live in production src. The
  // STRICT_GLM_FIRST fallback ordering pattern from the removed era stays
  // forbidden: platform selection is a static policy, never a runtime fallback.
  Object.freeze({ id: 'LEGACY_STRICT_GLM_FIRST', pattern: /STRICT_GLM_FIRST/ }),
  Object.freeze({ id: 'NODE_INTEGRATION_ENABLED', pattern: /nodeIntegration\s*:\s*true/ }),
  Object.freeze({ id: 'SANDBOX_DISABLED', pattern: /sandbox\s*:\s*false/ }),
  // R97 product contract: production Browser agents execute through the
  // authenticated z.ai Web UI. Managed/private model inference clients are
  // forbidden from the packaged Browser graph so a UI failure can never
  // silently fall back to an API/SDK path.
  Object.freeze({ id: 'MODEL_API_OPENAI_ENDPOINT', pattern: /https?:\\/\\/api\\.openai\\.com/i }),
  Object.freeze({ id: 'MODEL_API_ZAI_ENDPOINT', pattern: /https?:\\/\\/api\\.z\\.ai/i }),
  Object.freeze({ id: 'MODEL_API_ANTHROPIC_ENDPOINT', pattern: /https?:\\/\\/api\\.anthropic\\.com/i }),
  Object.freeze({ id: 'MODEL_API_VERCEL_GATEWAY_ENDPOINT', pattern: /https?:\\/\\/ai-gateway\\.vercel\\.sh/i }),
  Object.freeze({ id: 'MODEL_API_OPENAI_SECRET', pattern: /\\bOPENAI_API_KEY\\b/ }),
  Object.freeze({ id: 'MODEL_API_ANTHROPIC_SECRET', pattern: /\\bANTHROPIC_API_KEY\\b/ }),
  Object.freeze({ id: 'MODEL_API_ZAI_SECRET', pattern: /\\b(?:ZAI|GLM)_API_KEY\\b/ }),
  Object.freeze({ id: 'MODEL_API_OPENAI_SDK', pattern: /(?:from\\s*['"]openai['"]|require\\(\\s*['"]openai['"]\\s*\\))/ }),
  Object.freeze({ id: 'MODEL_API_ANTHROPIC_SDK', pattern: /(?:from\\s*['"]@anthropic-ai\\/sdk['"]|require\\(\\s*['"]@anthropic-ai\\/sdk['"]\\s*\\))/ }),
  Object.freeze({ id: 'MODEL_API_RESPONSES_PATH', pattern: /['"]\\/v1\\/responses['"]/ }),
  Object.freeze({ id: 'MODEL_API_CHAT_COMPLETIONS_PATH', pattern: /['"]\\/v1\\/chat\\/completions['"]/ }),
]);

const EFFECT_POOR_BOUNDARIES = Object.freeze([
  'src/verification-sandbox-plan.cjs',
  'src/development-plane-worker.cjs',
  'smoke/dp/main.cjs',
]);

const EFFECT_PRIMITIVE_RULES = Object.freeze([
  Object.freeze({ id: 'CHILD_PROCESS_IMPORT', pattern: /(?:node:)?child_process/ }),
  Object.freeze({ id: 'EXEC_PRIMITIVE', pattern: /\bexec\s*\(/ }),
  Object.freeze({ id: 'SPAWN_PRIMITIVE', pattern: /\bspawn\s*\(/ }),
  Object.freeze({ id: 'EVAL_PRIMITIVE', pattern: /\beval\s*\(/ }),
  Object.freeze({ id: 'FUNCTION_CONSTRUCTOR', pattern: /\bnew\s+Function\b/ }),
]);

function normalizedRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

async function collectTextFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  const out = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(target);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(target);
      }
    }
  };
  await walk(absoluteRoot);
  return out;
}

function ruleViolations(source, rules, file) {
  const rows = [];
  const lines = String(source).split(/\r?\n/);
  for (const rule of rules) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!rule.pattern.test(lines[index])) continue;
      rows.push(Object.freeze({
        file,
        line: index + 1,
        rule: rule.id,
      }));
    }
  }
  return rows;
}

export async function scanSecurityStaticGate({ rootDir = APP_ROOT } = {}) {
  const root = path.resolve(rootDir);
  const violations = [];
  const scanned = new Set();

  for (const relativeRoot of PRODUCTION_ROOTS) {
    const files = await collectTextFiles(root, relativeRoot);
    for (const filePath of files) {
      const file = normalizedRelative(root, filePath);
      const source = await fs.readFile(filePath, 'utf8');
      scanned.add(file);
      violations.push(...ruleViolations(source, PRODUCTION_ESCAPE_RULES, file));
    }
  }

  for (const file of EFFECT_POOR_BOUNDARIES) {
    const filePath = path.join(root, ...file.split('/'));
    let source;
    try {
      source = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        violations.push(Object.freeze({ file, line: 0, rule: 'EFFECT_POOR_BOUNDARY_MISSING' }));
        continue;
      }
      throw error;
    }
    scanned.add(file);
    violations.push(...ruleViolations(source, EFFECT_PRIMITIVE_RULES, file));
  }

  return Object.freeze({
    schema: SECURITY_STATIC_GATE_SCHEMA,
    ok: violations.length === 0,
    production_roots: PRODUCTION_ROOTS,
    effect_poor_boundaries: EFFECT_POOR_BOUNDARIES,
    scanned_file_count: scanned.size,
    violation_count: violations.length,
    violations: Object.freeze(violations),
    tests_excluded_from_production_scan: true,
    production_process_primitives_globally_forbidden: false,
    authority_effect: false,
  });
}

async function main() {
  const result = await scanSecurityStaticGate();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exitCode = 2;
  });
}
