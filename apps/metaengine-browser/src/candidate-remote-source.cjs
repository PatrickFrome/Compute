'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { verifyCandidateCapsule } = require('./candidate-capsule.cjs');

const REMOTE_SOURCE_PROOF_SCHEMA = 'metaengine.development-plane.remote-source-proof.v1';
const SHA40_RE = /^[0-9a-f]{40}$/;
const REMOTE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

function normalizeRepository(value) {
  const repository = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('candidate_remote_repository_invalid');
  return repository;
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('candidate_remote_source_invalid');
  const repository = normalizeRepository(source.repository);
  const head = String(source.head || '').toLowerCase();
  if (!SHA40_RE.test(head)) throw new Error('candidate_remote_head_invalid');
  const ref = String(source.ref || '');
  if (!ref.startsWith('refs/heads/') || ref.length > 240 || /[\u0000-\u0020~^:?*\\]/.test(ref) || ref.includes('..') || ref.includes('@{') || ref.endsWith('/') || ref.endsWith('.')) {
    throw new Error('candidate_remote_ref_invalid');
  }
  return { repository, head, ref };
}

function githubRepositoryFromRemoteUrl(value) {
  const url = String(value || '').trim();
  let match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) match = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) match = url.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) throw new Error('candidate_remote_url_untrusted');
  return `${match[1]}/${match[2]}`;
}

function gitExecutableCandidates({ platform = process.platform, env = process.env } = {}) {
  const candidates = ['git'];
  if (platform !== 'win32') return candidates;

  candidates.push('git.exe');
  const roots = [
    env?.ProgramFiles,
    env?.ProgramW6432,
    env?.['ProgramFiles(x86)'],
    'C:\\Program Files',
  ].filter((value) => typeof value === 'string' && value.trim());
  for (const root of roots) candidates.push(path.win32.join(root, 'Git', 'cmd', 'git.exe'));
  return [...new Set(candidates)];
}

function gitProbeOptions(cwd, env = process.env) {
  return {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      LC_ALL: 'C',
    },
  };
}

function probeGitWithCandidates(cwd, args, {
  platform = process.platform,
  env = process.env,
  execFile = execFileSync,
} = {}) {
  let missingError = null;
  for (const executable of gitExecutableCandidates({ platform, env })) {
    try {
      return String(execFile(executable, args, gitProbeOptions(cwd, env))).trim();
    } catch (error) {
      if (error?.code === 'ENOENT') {
        missingError = error;
        continue;
      }
      const detail = String(error?.stderr || error?.message || error).trim().slice(0, 240);
      throw new Error(`candidate_remote_probe_failed:${detail || 'unknown'}`);
    }
  }
  const detail = String(missingError?.stderr || missingError?.message || missingError || 'git_executable_not_found').trim().slice(0, 240);
  throw new Error(`candidate_remote_probe_failed:${detail || 'git_executable_not_found'}`);
}

function defaultRunGit(cwd, args) {
  return probeGitWithCandidates(cwd, args);
}

function parseLsRemote(raw, expectedRef) {
  const rows = String(raw || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^([0-9a-f]{40})\s+(.+)$/i);
    if (!match) throw new Error('candidate_remote_probe_output_invalid');
    return { head: match[1].toLowerCase(), ref: match[2] };
  }).filter((row) => row.ref === expectedRef);
  if (rows.length !== 1) throw new Error(rows.length ? 'candidate_remote_ref_ambiguous' : 'candidate_remote_ref_missing');
  return rows[0];
}

function proveRemoteSourceBinding(source, { cwd = process.cwd(), remote = 'origin', runGit = defaultRunGit } = {}) {
  const normalized = normalizeSource(source);
  const remoteName = String(remote || '');
  if (!REMOTE_NAME_RE.test(remoteName)) throw new Error('candidate_remote_name_invalid');
  if (typeof runGit !== 'function') throw new Error('candidate_remote_git_runner_invalid');

  const remoteUrl = runGit(cwd, ['remote', 'get-url', remoteName]);
  const remoteRepository = githubRepositoryFromRemoteUrl(remoteUrl);
  if (remoteRepository.toLowerCase() !== normalized.repository.toLowerCase()) throw new Error('candidate_remote_repository_mismatch');

  const raw = runGit(cwd, ['ls-remote', '--heads', remoteName, normalized.ref]);
  const observed = parseLsRemote(raw, normalized.ref);
  if (observed.head !== normalized.head) throw new Error(`candidate_remote_head_mismatch:${observed.head}:${normalized.head}`);

  return Object.freeze({
    schema: REMOTE_SOURCE_PROOF_SCHEMA,
    repository: normalized.repository,
    source_ref: normalized.ref,
    source_head: normalized.head,
    remote_name: remoteName,
    remote_repository: remoteRepository,
    remote_probe: 'GIT_LS_REMOTE_HEADS',
    remote_url_sha256: `sha256:${crypto.createHash('sha256').update(String(remoteUrl), 'utf8').digest('hex')}`,
    exact_remote_ref_match: true,
    mutates_refs: false,
    mutates_worktree: false,
    authority_effect: false,
  });
}

function verifyCandidateCapsuleRemoteBound(capsule, currentSource, options = {}) {
  const local = verifyCandidateCapsule(capsule, currentSource);
  const proof = proveRemoteSourceBinding(capsule.source, options);
  if (proof.source_head !== local.source_head) throw new Error('candidate_remote_receipt_head_mismatch');
  return Object.freeze({
    ...local,
    source_current: true,
    source_current_scope: 'AUTHORITATIVE_REMOTE_REF',
    remote_source_verified: true,
    remote_source_ref: proof.source_ref,
    remote_repository: proof.remote_repository,
    remote_probe: proof.remote_probe,
    remote_mutates_refs: false,
    remote_mutates_worktree: false,
    authority_effect: false,
  });
}

module.exports = Object.freeze({
  REMOTE_SOURCE_PROOF_SCHEMA,
  gitExecutableCandidates,
  probeGitWithCandidates,
  proveRemoteSourceBinding,
  verifyCandidateCapsuleRemoteBound,
});
