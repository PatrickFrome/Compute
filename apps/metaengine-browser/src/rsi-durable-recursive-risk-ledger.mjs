
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RsiRecursiveRiskLedger,
  verifyRsiRecursiveRiskBudget,
  verifyRsiExternalStatisticalCertificate,
  verifyRsiRiskConfirmation,
} from './rsi-recursive-risk-budget.mjs';
import {
  persistRsiDurableJsonState,
  reconcileRsiDurableJsonState,
  RsiDurableStatePersistenceError,
} from './rsi-durable-state-persistence.mjs';

export const RSI_DURABLE_RECURSIVE_RISK_LEDGER_SCHEMA='metaengine.rsi.durable-recursive-risk-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const MAX_CONFIRMATIONS=100000;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex');
}
function fileDigest(state){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(state)+'\n','utf8').digest('hex');
}
function exactSha(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA40_RE.test(out))throw new Error('rsi_durable_risk_'+label+'_sha_invalid');
  return out;
}
function exactDigest(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out))throw new Error('rsi_durable_risk_'+label+'_digest_invalid');
  return out;
}
function plain(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return proto===Object.prototype||proto===null;
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    scheduler_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZero(row,label){
  for(const field of [
    'execution_authority','browser_authority','task_authority','scheduler_authority',
    'production_mutation_authority','promotion_authority','self_update_authority',
    'signing_authority','authority_effect',
  ]){
    if(row?.[field]!==false)throw new Error('rsi_durable_risk_'+label+'_'+field+'_invalid');
  }
  if(row?.automatic_retry_allowed!==false)throw new Error('rsi_durable_risk_'+label+'_automatic_retry_invalid');
}

function normalizeRow(certificate,confirmation){
  const checked=verifyRsiRiskConfirmation(confirmation);
  const core={certificate:structuredClone(certificate),confirmation:structuredClone(checked)};
  return Object.freeze({...core,row_digest:digest(core)});
}

function replayRows({budget,rows}){
  const checkedBudget=verifyRsiRecursiveRiskBudget(budget);
  if(!Array.isArray(rows)||rows.length>MAX_CONFIRMATIONS)throw new Error('rsi_durable_risk_rows_invalid');
  const ledger=new RsiRecursiveRiskLedger({budget:checkedBudget});
  const normalized=[];
  for(let index=0;index<rows.length;index+=1){
    const raw=rows[index];
    if(!plain(raw)||!plain(raw.certificate)||!plain(raw.confirmation))throw new Error('rsi_durable_risk_row_invalid');
    const confirmation=verifyRsiRiskConfirmation(raw.confirmation);
    if(confirmation.confirmation_index!==index+1)throw new Error('rsi_durable_risk_confirmation_sequence_invalid');
    if(confirmation.budget_digest!==checkedBudget.budget_digest)throw new Error('rsi_durable_risk_budget_mismatch');
    const certificate=verifyRsiExternalStatisticalCertificate(raw.certificate,{
      budget:checkedBudget,
      expected_confirmation_index:index+1,
      candidate_id:confirmation.candidate_id,
      candidate_sha:confirmation.candidate_sha,
      parent_sha:confirmation.parent_sha,
      tournament_plan_digest:confirmation.tournament_plan_digest,
      holdout_digest:confirmation.holdout_digest,
      evaluator_root_digest:confirmation.evaluator_root_digest,
    });
    const replayed=ledger.confirm({
      certificate,
      candidate_id:confirmation.candidate_id,
      candidate_sha:confirmation.candidate_sha,
      parent_sha:confirmation.parent_sha,
      tournament_plan_digest:confirmation.tournament_plan_digest,
      holdout_digest:confirmation.holdout_digest,
      evaluator_root_digest:confirmation.evaluator_root_digest,
    });
    if(replayed.confirmation_digest!==confirmation.confirmation_digest){
      throw new Error('rsi_durable_risk_confirmation_replay_mismatch');
    }
    const row=normalizeRow(certificate,confirmation);
    if(raw.row_digest!=null&&exactDigest(raw.row_digest,'row')!==row.row_digest){
      throw new Error('rsi_durable_risk_row_digest_mismatch');
    }
    normalized.push(row);
  }
  return Object.freeze({budget:checkedBudget,ledger,rows:Object.freeze(normalized)});
}

function stateFor({sourceSha,budget,rows}){
  const source=exactSha(sourceSha,'source');
  const replay=replayRows({budget,rows});
  const snapshot=replay.ledger.snapshot();
  const core=zero({
    schema:RSI_DURABLE_RECURSIVE_RISK_LEDGER_SCHEMA,
    version:1,
    source_sha:source,
    budget:replay.budget,
    budget_digest:replay.budget.budget_digest,
    rows:replay.rows.map((row)=>structuredClone(row)),
    confirmation_count:snapshot.confirmation_count,
    cumulative_alpha_spent:snapshot.cumulative_alpha_spent,
    global_alpha:snapshot.global_alpha,
    remaining_alpha_upper_bound:snapshot.remaining_alpha_upper_bound,
    next_confirmation_index:snapshot.next_confirmation_index,
    next_confirmation_alpha_allocation:snapshot.next_confirmation_alpha_allocation,
    spend_trigger:'CONFIRMATION_EVENT_ONLY',
    screening_spends_alpha:false,
    proposal_round_spends_alpha:false,
    append_only:true,
    confirmation_index_ledger_owned:true,
    cumulative_alpha_restart_verified:true,
    durable_before_visible:true,
    crash_ambiguity_requires_reconciliation:true,
    same_attempt_blind_retry_allowed:false,
    second_statistical_authority_created:false,
  });
  return Object.freeze({...core,state_digest:digest(core)});
}

export function verifyRsiDurableRecursiveRiskLedgerState(state,{source_sha,budget}={}){
  if(!plain(state)||state.schema!==RSI_DURABLE_RECURSIVE_RISK_LEDGER_SCHEMA||state.version!==1){
    throw new Error('rsi_durable_risk_state_invalid');
  }
  assertZero(state,'state');
  if(state.spend_trigger!=='CONFIRMATION_EVENT_ONLY'
    ||state.screening_spends_alpha!==false
    ||state.proposal_round_spends_alpha!==false
    ||state.append_only!==true
    ||state.confirmation_index_ledger_owned!==true
    ||state.cumulative_alpha_restart_verified!==true
    ||state.durable_before_visible!==true
    ||state.crash_ambiguity_requires_reconciliation!==true
    ||state.same_attempt_blind_retry_allowed!==false
    ||state.second_statistical_authority_created!==false){
    throw new Error('rsi_durable_risk_state_policy_invalid');
  }
  const source=exactSha(source_sha??state.source_sha,'expected_source');
  if(state.source_sha!==source)throw new Error('rsi_durable_risk_source_mismatch');
  const checkedBudget=verifyRsiRecursiveRiskBudget(budget??state.budget);
  if(state.budget_digest!==checkedBudget.budget_digest)throw new Error('rsi_durable_risk_budget_mismatch');
  const canonical=stateFor({sourceSha:source,budget:checkedBudget,rows:state.rows});
  if(canonical.state_digest!==exactDigest(state.state_digest,'state')){
    throw new Error('rsi_durable_risk_state_digest_mismatch');
  }
  return canonical;
}

export class RsiDurableRecursiveRiskLedger{
  #path;
  #sourceSha;
  #budget;
  #rows=[];
  #initialized=false;
  #ambiguous=null;
  #io;
  #platform;

  constructor({statePath,source_sha,budget,io=fs,platform=process.platform}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_durable_risk_path_required');
    if(!io||typeof io.readFile!=='function'||typeof io.open!=='function'||typeof io.rename!=='function'){
      throw new Error('rsi_durable_risk_io_invalid');
    }
    this.#path=path.resolve(statePath);
    this.#sourceSha=exactSha(source_sha,'source');
    this.#budget=verifyRsiRecursiveRiskBudget(budget);
    this.#io=io;
    this.#platform=platform;
  }

  async init(){
    if(this.#initialized)return this.snapshot();
    if(typeof this.#io.mkdir==='function')await this.#io.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await this.#io.readFile(this.#path,'utf8'));
      const checked=verifyRsiDurableRecursiveRiskLedgerState(parsed,{source_sha:this.#sourceSha,budget:this.#budget});
      this.#rows=checked.rows.map((row)=>Object.freeze(structuredClone(row)));
    }catch(error){
      if(error?.code!=='ENOENT')throw error;
    }
    this.#initialized=true;
    return this.snapshot();
  }

  #assertReady(){
    if(!this.#initialized)throw new Error('rsi_durable_risk_not_initialized');
    if(this.#ambiguous)throw new Error('rsi_durable_risk_reconciliation_required');
  }

  #state(){
    return stateFor({sourceSha:this.#sourceSha,budget:this.#budget,rows:this.#rows});
  }

  async confirm({certificate,candidate_id,candidate_sha,parent_sha,tournament_plan_digest,holdout_digest,evaluator_root_digest}={}){
    this.#assertReady();
    const replay=replayRows({budget:this.#budget,rows:this.#rows});
    const confirmation=replay.ledger.confirm({
      certificate,candidate_id,candidate_sha,parent_sha,tournament_plan_digest,holdout_digest,evaluator_root_digest,
    });
    const checkedCertificate=verifyRsiExternalStatisticalCertificate(certificate,{
      budget:this.#budget,
      expected_confirmation_index:confirmation.confirmation_index,
      candidate_id:confirmation.candidate_id,
      candidate_sha:confirmation.candidate_sha,
      parent_sha:confirmation.parent_sha,
      tournament_plan_digest:confirmation.tournament_plan_digest,
      holdout_digest:confirmation.holdout_digest,
      evaluator_root_digest:confirmation.evaluator_root_digest,
    });
    const row=normalizeRow(checkedCertificate,confirmation);
    const predecessor=this.#state();
    const proposed=stateFor({sourceSha:this.#sourceSha,budget:this.#budget,rows:[...this.#rows,row]});
    try{
      const persistence=await persistRsiDurableJsonState({
        file_path:this.#path,state:proposed,io:this.#io,platform:this.#platform,
      });
      this.#rows=proposed.rows.map((candidate)=>Object.freeze(structuredClone(candidate)));
      return zero({
        schema:'metaengine.rsi.durable-risk-confirmation-result.v1',
        version:1,
        state:'CONFIRMED_DURABLE',
        confirmation:structuredClone(confirmation),
        confirmation_digest:confirmation.confirmation_digest,
        durable_ledger_state_digest:proposed.state_digest,
        confirmation_count:proposed.confirmation_count,
        cumulative_alpha_spent:proposed.cumulative_alpha_spent,
        persistence_expected_state_digest:persistence.expected_state_digest,
        persistence_expected_file_digest:persistence.expected_file_digest,
        durable_before_visible:true,
        reconciliation_required:false,
      });
    }catch(error){
      if(error instanceof RsiDurableStatePersistenceError&&error.reconciliation_required===true){
        this.#ambiguous=Object.freeze({
          proposed_state:proposed,
          predecessor_state:predecessor,
          expected_state_digest:error.expected_state_digest,
          expected_file_digest:error.expected_file_digest,
          persistence_stage:error.stage,
        });
      }
      throw error;
    }
  }

  async reconcile(){
    if(!this.#initialized)throw new Error('rsi_durable_risk_not_initialized');
    if(!this.#ambiguous){
      return zero({
        schema:'metaengine.rsi.durable-risk-reconciliation.v1',
        version:1,
        state:'NO_RECONCILIATION_REQUIRED',
        confirmation_count:this.#rows.length,
        reconciliation_required:false,
      });
    }
    const pending=this.#ambiguous;
    const proposedReadback=await reconcileRsiDurableJsonState({
      file_path:this.#path,
      expected_state_digest:pending.expected_state_digest,
      expected_file_digest:pending.expected_file_digest,
      rename_may_have_completed:true,
      io:this.#io,
    });
    if(proposedReadback.state==='CONFIRMED_EXACT_READBACK'){
      const parsed=JSON.parse(await this.#io.readFile(this.#path,'utf8'));
      const checked=verifyRsiDurableRecursiveRiskLedgerState(parsed,{source_sha:this.#sourceSha,budget:this.#budget});
      this.#rows=checked.rows.map((row)=>Object.freeze(structuredClone(row)));
      this.#ambiguous=null;
      return zero({
        schema:'metaengine.rsi.durable-risk-reconciliation.v1',
        version:1,
        state:'CONFIRMED_DURABLE_AFTER_RECONCILIATION',
        durable_ledger_state_digest:checked.state_digest,
        confirmation_count:checked.confirmation_count,
        new_attempt_allowed:false,
        reconciliation_required:false,
      });
    }
    const predecessor=pending.predecessor_state;
    const predecessorReadback=await reconcileRsiDurableJsonState({
      file_path:this.#path,
      expected_state_digest:digest(predecessor),
      expected_file_digest:fileDigest(predecessor),
      rename_may_have_completed:true,
      io:this.#io,
    });
    if(predecessorReadback.state==='CONFIRMED_EXACT_READBACK'){
      const parsed=JSON.parse(await this.#io.readFile(this.#path,'utf8'));
      const checked=verifyRsiDurableRecursiveRiskLedgerState(parsed,{source_sha:this.#sourceSha,budget:this.#budget});
      this.#rows=checked.rows.map((row)=>Object.freeze(structuredClone(row)));
      this.#ambiguous=null;
      return zero({
        schema:'metaengine.rsi.durable-risk-reconciliation.v1',
        version:1,
        state:'NO_EFFECT_PROVEN_NEW_CONFIRMATION_ALLOWED',
        durable_ledger_state_digest:checked.state_digest,
        confirmation_count:checked.confirmation_count,
        new_attempt_allowed:true,
        reconciliation_required:false,
      });
    }
    return zero({
      schema:'metaengine.rsi.durable-risk-reconciliation.v1',
      version:1,
      state:'RECONCILIATION_ONLY',
      proposed_readback_state:proposedReadback.state,
      predecessor_readback_state:predecessorReadback.state,
      new_attempt_allowed:false,
      reconciliation_required:true,
    });
  }

  state(){
    if(!this.#initialized)throw new Error('rsi_durable_risk_not_initialized');
    return structuredClone(this.#state());
  }

  confirmationByDigest(confirmation_digest){
    if(!this.#initialized)throw new Error('rsi_durable_risk_not_initialized');
    const expected=exactDigest(confirmation_digest,'confirmation_lookup');
    const row=this.#rows.find((candidate)=>candidate.confirmation.confirmation_digest===expected);
    return row?Object.freeze(structuredClone(row.confirmation)):null;
  }

  snapshot(){
    const state=this.#state();
    return Object.freeze({
      schema:RSI_DURABLE_RECURSIVE_RISK_LEDGER_SCHEMA,
      version:1,
      source_sha:state.source_sha,
      initialized:this.#initialized,
      budget_digest:state.budget_digest,
      confirmation_count:state.confirmation_count,
      cumulative_alpha_spent:state.cumulative_alpha_spent,
      global_alpha:state.global_alpha,
      remaining_alpha_upper_bound:state.remaining_alpha_upper_bound,
      next_confirmation_index:state.next_confirmation_index,
      next_confirmation_alpha_allocation:state.next_confirmation_alpha_allocation,
      durable_ledger_state_digest:state.state_digest,
      append_only:true,
      confirmation_index_ledger_owned:true,
      cumulative_alpha_restart_verified:true,
      durable_before_visible:true,
      reconciliation_required:this.#ambiguous!=null,
      same_attempt_blind_retry_allowed:false,
      second_statistical_authority_created:false,
      execution_authority:false,
      browser_authority:false,
      task_authority:false,
      scheduler_authority:false,
      production_mutation_authority:false,
      promotion_authority:false,
      self_update_authority:false,
      signing_authority:false,
      automatic_retry_allowed:false,
      authority_effect:false,
    });
  }
}

export function rsiDurableRecursiveRiskTrustRootSnapshot(){
  const root=zero({
    schema:'metaengine.rsi.durable-recursive-risk-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-durable-recursive-risk-ledger.mjs',
    existing_recursive_risk_budget_reused:true,
    second_statistical_authority_created:false,
    durable_state_primitive_reused:true,
    confirmation_index_ledger_owned:true,
    cumulative_alpha_restart_verified:true,
    durable_before_visible:true,
    pre_rename_failure_does_not_mutate_visible_rows:true,
    post_rename_failure_requires_reconciliation:true,
    proposed_and_predecessor_exact_readback_supported:true,
    ambiguous_state_blocks_new_confirmation:true,
    same_attempt_blind_retry_allowed:false,
  });
  return Object.freeze({...root,root_digest:digest(root)});
}
