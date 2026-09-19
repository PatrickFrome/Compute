
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RSI_RISK_SPENDING_POLICIES,
  createRsiRecursiveRiskBudget,
  createRsiExternalStatisticalCertificate,
  rsiRiskAllocationForConfirmation,
} from '../src/rsi-recursive-risk-budget.mjs';
import {
  RsiDurableRecursiveRiskLedger,
  verifyRsiDurableRecursiveRiskLedgerState,
  createRsiDurableRiskConfirmationWitness,
  verifyRsiDurableRiskConfirmationWitness,
  rsiDurableRecursiveRiskTrustRootSnapshot,
} from '../src/rsi-durable-recursive-risk-ledger.mjs';
import { RsiDurableStatePersistenceError } from '../src/rsi-durable-state-persistence.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>'sha256:'+char.repeat(64);
const sha=(char)=>char.repeat(40);
const candidateId=(char)=>'candidate_sha256_'+char.repeat(64);

function budget(){
  return createRsiRecursiveRiskBudget({
    budget_id:'rsi.durable.risk.test',
    global_alpha:0.05,
    spending_policy:RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
    evidence_family:'RSI_DURABLE_RISK_TEST',
  });
}

function binding(char='1'){
  return {
    candidate_id:candidateId(char),
    candidate_sha:sha(char),
    parent_sha:sha('0'),
    tournament_plan_digest:d('4'),
    holdout_digest:d('6'),
    evaluator_root_digest:d('5'),
  };
}

function certificateFor(b,index,char='1'){
  const bind=binding(char);
  return createRsiExternalStatisticalCertificate({
    certificate_id:'durable-stat-'+char+'-'+index,
    budget:b,
    confirmation_index:index,
    ...bind,
    method:'E_VALUE_EXTERNAL_V1',
    alpha_used:rsiRiskAllocationForConfirmation(b,index),
    superiority_certified:true,
    paired_evaluation:true,
    independent_holdout:true,
    stopping_rule_precommitted:true,
    optional_stopping_used:false,
    familywise_valid:true,
    screening_spent_alpha:false,
    confirmation_triggered:true,
    sample_count:32,
    evidence_refs:['DURABLE_RUN_'+index,'DURABLE_HOLDOUT_'+index],
    external_verifier:true,
    authored_by_candidate:false,
  });
}

function failOnceIo({finalPath,failTempSync=false,failFinalSync=false}={}){
  let tempFailed=false;
  let finalFailed=false;
  return {
    mkdir:(...args)=>fs.mkdir(...args),
    readFile:(...args)=>fs.readFile(...args),
    rename:(...args)=>fs.rename(...args),
    async open(filePath,flags,mode){
      const handle=await fs.open(filePath,flags,mode);
      const resolved=path.resolve(filePath);
      const isFinal=resolved===path.resolve(finalPath);
      const isTemp=resolved===path.resolve(finalPath+'.tmp');
      return {
        writeFile:(...args)=>handle.writeFile(...args),
        async sync(){
          if(isTemp&&failTempSync&&!tempFailed){
            tempFailed=true;
            throw Object.assign(new Error('injected_temp_sync_failure'),{code:'EINJECT'});
          }
          if(isFinal&&failFinalSync&&!finalFailed){
            finalFailed=true;
            throw Object.assign(new Error('injected_final_sync_failure'),{code:'EINJECT'});
          }
          return handle.sync();
        },
        close:()=>handle.close(),
      };
    },
  };
}

test('durable recursive risk ledger owns confirmation index across restart and cannot reuse index one',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-durable-risk-restart-'));
  try{
    const statePath=path.join(root,'risk.json');
    const b=budget();
    const first=new RsiDurableRecursiveRiskLedger({statePath,source_sha:SOURCE,budget:b});
    await first.init();

    const r1=await first.confirm({certificate:certificateFor(b,1,'1'),...binding('1')});
    assert.equal(r1.state,'CONFIRMED_DURABLE');
    assert.equal(first.snapshot().confirmation_count,1);
    assert.equal(first.snapshot().next_confirmation_index,2);

    const restored=new RsiDurableRecursiveRiskLedger({statePath,source_sha:SOURCE,budget:b});
    await restored.init();
    assert.equal(restored.snapshot().confirmation_count,1);
    assert.equal(restored.snapshot().next_confirmation_index,2);
    assert.ok(restored.snapshot().cumulative_alpha_spent>0);

    await assert.rejects(
      ()=>restored.confirm({certificate:certificateFor(b,1,'2'),...binding('2')}),
      /confirmation_index_mismatch/,
    );

    const r2=await restored.confirm({certificate:certificateFor(b,2,'2'),...binding('2')});
    assert.equal(r2.confirmation.confirmation_index,2);
    assert.equal(restored.snapshot().confirmation_count,2);
    assert.equal(restored.snapshot().next_confirmation_index,3);

    const checked=verifyRsiDurableRecursiveRiskLedgerState(restored.state(),{source_sha:SOURCE,budget:b});
    assert.equal(checked.confirmation_count,2);
    assert.equal(checked.rows[0].confirmation.confirmation_index,1);
    assert.equal(checked.rows[1].confirmation.confirmation_index,2);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('pre-rename persistence failure never creates a visible confirmation and a new call may retry safely',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-durable-risk-pre-rename-'));
  try{
    const statePath=path.join(root,'risk.json');
    const b=budget();
    const io=failOnceIo({finalPath:statePath,failTempSync:true});
    const ledger=new RsiDurableRecursiveRiskLedger({statePath,source_sha:SOURCE,budget:b,io,platform:process.platform});
    await ledger.init();

    await assert.rejects(
      ()=>ledger.confirm({certificate:certificateFor(b,1,'1'),...binding('1')}),
      (error)=>{
        assert.ok(error instanceof RsiDurableStatePersistenceError);
        assert.equal(error.rename_completed,false);
        assert.equal(error.new_attempt_allowed,true);
        return true;
      },
    );
    assert.equal(ledger.snapshot().confirmation_count,0);
    assert.equal(ledger.snapshot().reconciliation_required,false);

    const result=await ledger.confirm({certificate:certificateFor(b,1,'1'),...binding('1')});
    assert.equal(result.state,'CONFIRMED_DURABLE');
    assert.equal(ledger.snapshot().confirmation_count,1);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('post-rename persistence failure latches ambiguity and reconciles from durable final readback before visibility',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-durable-risk-post-rename-'));
  try{
    const statePath=path.join(root,'risk.json');
    const b=budget();
    const io=failOnceIo({finalPath:statePath,failFinalSync:true});
    const ledger=new RsiDurableRecursiveRiskLedger({statePath,source_sha:SOURCE,budget:b,io,platform:process.platform});
    await ledger.init();

    await assert.rejects(
      ()=>ledger.confirm({certificate:certificateFor(b,1,'1'),...binding('1')}),
      (error)=>{
        assert.ok(error instanceof RsiDurableStatePersistenceError);
        assert.equal(error.rename_completed,true);
        assert.equal(error.reconciliation_required,true);
        return true;
      },
    );

    assert.equal(ledger.snapshot().confirmation_count,0);
    assert.equal(ledger.snapshot().reconciliation_required,true);
    await assert.rejects(
      ()=>ledger.confirm({certificate:certificateFor(b,1,'1'),...binding('1')}),
      /reconciliation_required/,
    );

    const reconciled=await ledger.reconcile();
    assert.equal(reconciled.state,'CONFIRMED_DURABLE_AFTER_RECONCILIATION');
    assert.equal(reconciled.confirmation_count,1);
    assert.equal(reconciled.new_attempt_allowed,false);
    assert.equal(ledger.snapshot().confirmation_count,1);
    assert.equal(ledger.snapshot().reconciliation_required,false);

    const restored=new RsiDurableRecursiveRiskLedger({statePath,source_sha:SOURCE,budget:b});
    await restored.init();
    assert.equal(restored.snapshot().confirmation_count,1);
    assert.equal(restored.snapshot().next_confirmation_index,2);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('durable state rejects tampered sequence cumulative history and candidate replay',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-durable-risk-tamper-'));
  try{
    const statePath=path.join(root,'risk.json');
    const b=budget();
    const ledger=new RsiDurableRecursiveRiskLedger({statePath,source_sha:SOURCE,budget:b});
    await ledger.init();
    await ledger.confirm({certificate:certificateFor(b,1,'1'),...binding('1')});

    const state=ledger.state();
    const tampered=structuredClone(state);
    tampered.rows[0].confirmation.confirmation_index=2;
    await assert.rejects(async()=>{
      verifyRsiDurableRecursiveRiskLedgerState(tampered,{source_sha:SOURCE,budget:b});
    },/confirmation_sequence_invalid|confirmation_digest_mismatch/);

    await assert.rejects(
      ()=>ledger.confirm({certificate:certificateFor(b,2,'1'),...binding('1')}),
      /confirmation_duplicate/,
    );
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('durable risk confirmation witness survives restart and binds the exact durable row',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-durable-risk-witness-'));
  try{
    const statePath=path.join(root,'risk.json');
    const b=budget();
    const ledger=new RsiDurableRecursiveRiskLedger({statePath,source_sha:SOURCE,budget:b});
    await ledger.init();
    const confirmed=await ledger.confirm({certificate:certificateFor(b,1,'1'),...binding('1')});

    const witness=ledger.confirmationWitness({
      confirmation_digest:confirmed.confirmation_digest,
      readback_owner_identity_digest:d('9'),
      external_readback_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(witness.confirmation_digest,confirmed.confirmation_digest);
    assert.equal(witness.durable_ledger_state_digest,ledger.state().state_digest);
    assert.equal(witness.confirmation_index,1);
    assert.equal(witness.restart_replay_verified,true);
    assert.equal(witness.witness_is_effect_authority,false);
    assert.equal(witness.authority_effect,false);

    const restored=new RsiDurableRecursiveRiskLedger({statePath,source_sha:SOURCE,budget:b});
    await restored.init();
    const restoredWitness=restored.confirmationWitness({
      confirmation_digest:confirmed.confirmation_digest,
      readback_owner_identity_digest:d('9'),
      external_readback_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(restoredWitness.witness_digest,witness.witness_digest);
    assert.deepEqual(
      verifyRsiDurableRiskConfirmationWitness(restoredWitness,{
        durable_ledger_state:restored.state(),
        source_sha:SOURCE,
        recursive_risk_budget:b,
      }),
      restoredWitness,
    );
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('durable risk witness rejects row absence, state tampering, and forged witness fields',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-durable-risk-witness-negative-'));
  try{
    const statePath=path.join(root,'risk.json');
    const b=budget();
    const ledger=new RsiDurableRecursiveRiskLedger({statePath,source_sha:SOURCE,budget:b});
    await ledger.init();
    const confirmed=await ledger.confirm({certificate:certificateFor(b,1,'1'),...binding('1')});
    const witness=createRsiDurableRiskConfirmationWitness({
      durable_ledger_state:ledger.state(),
      source_sha:SOURCE,
      recursive_risk_budget:b,
      confirmation_digest:confirmed.confirmation_digest,
      readback_owner_identity_digest:d('8'),
      external_readback_owner:true,
      authored_by_candidate:false,
    });

    assert.throws(
      ()=>createRsiDurableRiskConfirmationWitness({
        durable_ledger_state:{...ledger.state(),rows:[]},
        source_sha:SOURCE,
        recursive_risk_budget:b,
        confirmation_digest:confirmed.confirmation_digest,
        readback_owner_identity_digest:d('8'),
        external_readback_owner:true,
        authored_by_candidate:false,
      }),
      /state_digest_mismatch|confirmation_not_in_durable_state/,
    );

    assert.throws(
      ()=>verifyRsiDurableRiskConfirmationWitness({...witness,confirmation_index:2},{
        durable_ledger_state:ledger.state(),
        source_sha:SOURCE,
        recursive_risk_budget:b,
      }),
      /witness_digest_mismatch/,
    );
    assert.throws(
      ()=>verifyRsiDurableRiskConfirmationWitness({...witness,authority_effect:true},{
        durable_ledger_state:ledger.state(),
        source_sha:SOURCE,
        recursive_risk_budget:b,
      }),
      /witness_authority_effect_invalid/,
    );
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('durable recursive risk trust root creates no second statistical authority and requires crash reconciliation',()=>{
  const root=rsiDurableRecursiveRiskTrustRootSnapshot();
  assert.equal(root.existing_recursive_risk_budget_reused,true);
  assert.equal(root.second_statistical_authority_created,false);
  assert.equal(root.durable_state_primitive_reused,true);
  assert.equal(root.confirmation_index_ledger_owned,true);
  assert.equal(root.cumulative_alpha_restart_verified,true);
  assert.equal(root.durable_before_visible,true);
  assert.equal(root.post_rename_failure_requires_reconciliation,true);
  assert.equal(root.ambiguous_state_blocks_new_confirmation,true);
  assert.equal(root.exact_confirmation_witness_supported,true);
  assert.equal(root.witness_requires_external_durable_readback_owner,true);
  assert.equal(root.witness_replays_durable_row_against_existing_recursive_risk_ledger,true);
  assert.equal(root.witness_is_effect_authority,false);
  assert.equal(root.same_attempt_blind_retry_allowed,false);
  assert.equal(root.authority_effect,false);
});
