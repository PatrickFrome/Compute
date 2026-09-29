import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateR83LiveEvidenceSeal } from '../scripts/verify-r83-live-evidence-seal.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT=path.resolve(HERE,'../../..');
const EVIDENCE_PATH=path.join(REPO_ROOT,'coordination','convergence','R83_LIVE_EVIDENCE_SEAL_V1.json');

async function fixture(){
  const evidence=JSON.parse(await fs.readFile(EVIDENCE_PATH,'utf8'));
  const installed=evidence.installed_electron;
  const subject=evidence.subject;
  const proof={
    schema:'metaengine.client-v1.installed-electron-live.v1',
    source_head:subject.source_head,
    package_version:subject.package_version,
    installer_sha256:subject.installer_sha256,
    producer_run_id:installed.producer_run_id,
    producer_run_number:installed.producer_run_number,
    producer_run_attempt:installed.producer_run_attempt,
    client_id:installed.client_id,
    device_id:installed.device_id,
    key_fingerprint_sha256:installed.key_fingerprint_sha256,
    signed_transport_ready:true,
    producer_terminal_success:true,
    installed_process_alive:true,
    private_key_exported:false,
    authority_effect:false,
  };
  const runs=Object.fromEntries(evidence.github.required_runs.map(row=>[
    String(row.run_id),
    {
      id:row.run_id,
      name:row.name,
      head_sha:subject.source_head,
      status:'completed',
      conclusion:'success',
      run_attempt:row.run_attempt??1,
    },
  ]));
  return {evidence,proof,runs};
}

test('R83 live evidence seal binds exact frozen subject without granting promotion authority',async()=>{
  const {evidence,proof,runs}=await fixture();
  const result=validateR83LiveEvidenceSeal(evidence,{installedProof:proof,githubRuns:runs});
  assert.equal(result.verified,true);
  assert.equal(result.subject_source_head,'00d7c814213a97ac17504d5c598818bd99c588cb');
  assert.equal(result.installer_sha256,'0214578fa908d703f613506ebc3519149e7c1d8a63bb6ebe452da7d5c4796486');
  assert.equal(result.command_id,'d89881a8-8330-4c49-8dbe-bcf428ef0825');
  assert.equal(result.stable_edge_digest,result.canary_edge_digest);
  assert.match(result.evidence_sha256,/^[0-9a-f]{64}$/);
  assert.equal(result.execution_authority,false);
  assert.equal(result.promotion_authority,false);
  assert.equal(result.authority_effect,false);
});

test('R83 seal rejects post-hoc subject drift and Edge divergence',async()=>{
  const {evidence,proof,runs}=await fixture();
  const drift=structuredClone(evidence);
  drift.installed_electron.command.source_head='f'.repeat(40);
  assert.throws(()=>validateR83LiveEvidenceSeal(drift,{installedProof:proof,githubRuns:runs}),/command_source_head_mismatch/);

  const edge=structuredClone(evidence);
  edge.edge.canary.ezbr_sha256='f'.repeat(64);
  assert.throws(()=>validateR83LiveEvidenceSeal(edge,{installedProof:proof,githubRuns:runs}),/stable_canary_digest_mismatch/);
});

test('R83 seal rejects proof substitution, private-key export and failed producer/run evidence',async()=>{
  const {evidence,proof,runs}=await fixture();

  const substituted={...proof,device_id:'11111111-1111-4111-8111-111111111111'};
  assert.throws(()=>validateR83LiveEvidenceSeal(evidence,{installedProof:substituted,githubRuns:runs}),/installed_proof_device_mismatch/);

  const leaked={...proof,private_key_exported:true};
  assert.throws(()=>validateR83LiveEvidenceSeal(evidence,{installedProof:leaked,githubRuns:runs}),/installed_proof_private_key_exported/);

  const badRuns=structuredClone(runs);
  badRuns[String(evidence.installed_electron.producer_run_id)].conclusion='failure';
  assert.throws(()=>validateR83LiveEvidenceSeal(evidence,{installedProof:proof,githubRuns:badRuns}),/github_run_not_success/);
});

test('R83 evidence remains non-authoritative even when all evidence is structurally valid',async()=>{
  const {evidence,proof,runs}=await fixture();
  for(const key of ['evidence_is_execution_authority','evidence_is_promotion_authority','promotion_authorized','automatic_retry_allowed','authority_effect']){
    const bad=structuredClone(evidence);
    bad.policy[key]=true;
    assert.throws(()=>validateR83LiveEvidenceSeal(bad,{installedProof:proof,githubRuns:runs}),new RegExp('policy_'+key));
  }
});
