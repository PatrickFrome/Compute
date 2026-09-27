#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const R81_SOURCE_HYGIENE_SCHEMA = 'metaengine.r81.source-hygiene-audit.v1';

const SECRET_PATTERNS = Object.freeze([
  ['GITHUB_CLASSIC_PAT', /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g],
  ['GITHUB_FINE_GRAINED_PAT', /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g],
  ['OPENAI_API_KEY', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
  ['ANTHROPIC_API_KEY', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['AWS_ACCESS_KEY_ID', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['SLACK_TOKEN', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['PRIVATE_KEY_BLOCK', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
]);

const NAMED_SECRET_ASSIGNMENT = /\b(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|GH_TOKEN|PAP_CHATGPT_TOKEN|Z_AI_API_KEY|ZAI_API_KEY)\b\s*[:=]\s*["']?([^\s"'#]{12,})/g;

function placeholder(value) {
  const v = String(value || '').trim();
  return !v
    || /^\$\{?[A-Z0-9_]+\}?$/i.test(v)
    || /^<[^>]+>$/.test(v)
    || /^(?:process\.env\.[A-Z0-9_]+|Deno\.env\.get\([^)]*\))$/i.test(v)
    || /^(?:redacted|masked|placeholder|example|changeme|dummy|test[_-]?only|your[_-])/i.test(v)
    || /^\*+$/.test(v);
}

export function scanText(text, sourcePath = '<memory>') {
  const findings = [];
  const lineOf = (offset) => text.slice(0, offset).split('\n').length;
  for (const [kind, regex] of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      findings.push(Object.freeze({ kind, path: sourcePath, line: lineOf(match.index ?? 0) }));
    }
  }
  NAMED_SECRET_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(NAMED_SECRET_ASSIGNMENT)) {
    if (placeholder(match[2])) continue;
    findings.push(Object.freeze({
      kind: 'NAMED_SECRET_LITERAL',
      variable: match[1],
      path: sourcePath,
      line: lineOf(match.index ?? 0),
    }));
  }
  return findings;
}

function trackedFiles(repoRoot) {
  const raw = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return raw.split('\0').filter(Boolean);
}

export function auditRepository(repoRoot = process.cwd()) {
  const findings = [];
  let scannedFiles = 0;
  let skippedBinary = 0;
  let skippedLarge = 0;
  for (const rel of trackedFiles(repoRoot)) {
    const absolute = path.join(repoRoot, rel);
    let stat;
    try { stat = fs.statSync(absolute); } catch { continue; }
    if (!stat.isFile()) continue;
    if (stat.size > 2 * 1024 * 1024) {
      skippedLarge += 1;
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    if (bytes.includes(0)) {
      skippedBinary += 1;
      continue;
    }
    scannedFiles += 1;
    findings.push(...scanText(bytes.toString('utf8'), rel));
  }
  return Object.freeze({
    schema: R81_SOURCE_HYGIENE_SCHEMA,
    tracked_file_count: trackedFiles(repoRoot).length,
    scanned_text_file_count: scannedFiles,
    skipped_binary_file_count: skippedBinary,
    skipped_large_file_count: skippedLarge,
    finding_count: findings.length,
    findings,
    raw_secret_values_emitted: false,
    authority_effect: false,
  });
}

function main() {
  const repoRoot = path.resolve(process.argv[2] || process.cwd());
  const report = auditRepository(repoRoot);
  console.log(JSON.stringify({
    schema: report.schema,
    tracked_file_count: report.tracked_file_count,
    scanned_text_file_count: report.scanned_text_file_count,
    skipped_binary_file_count: report.skipped_binary_file_count,
    skipped_large_file_count: report.skipped_large_file_count,
    finding_count: report.finding_count,
    raw_secret_values_emitted: false,
    authority_effect: false,
  }));
  for (const finding of report.findings) {
    console.error(JSON.stringify(finding));
  }
  if (report.finding_count > 0) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
