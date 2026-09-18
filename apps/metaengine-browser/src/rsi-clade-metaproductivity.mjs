import crypto from 'node:crypto';

export const RSI_CLADE_NODE_SCHEMA = 'metaengine.rsi.clade-node.v1';
export const RSI_CLADE_ARCHIVE_SCHEMA = 'metaengine.rsi.clade-archive.v1';
export const RSI_CLADE_METAPRODUCTIVITY_SNAPSHOT_SCHEMA = 'metaengine.rsi.clade-metaproductivity-snapshot.v1';
export const RSI_CLADE_EXPANSION_PLAN_SCHEMA = 'metaengine.rsi.clade-expansion-plan.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_NODES = 4096;
const MAX_SLOTS = 64;

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactDigest(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_clade_${label}_digest_invalid`);
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_clade_${label}_sha_invalid`);
  return out;
}

function candidateId(value, label) {
  const out = String(value || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error(`rsi_clade_${label}_candidate_id_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_clade_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_clade_${label}_invalid`);
  return out;
}

function nonNegativeInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0 || out > max) throw new Error(`rsi_clade_${label}_invalid`);
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']) {
    if (value?.[field] !== false) throw new Error(`rsi_clade_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_clade_${label}_automatic_retry_invalid`);
}

function createZeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function createRsiCladeNode({
  node_id,
  candidate_id,
  candidate_sha,
  parent_candidate_id = null,
  benchmark_solved,
  benchmark_total,
  evaluation_digest,
  expansion_count = 0,
  external_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  if (external_evaluator !== true || authored_by_candidate !== false) throw new Error('rsi_clade_node_external_origin_required');
  const total = positiveInt(benchmark_total, 'benchmark_total', 10_000_000);
  const solved = nonNegativeInt(benchmark_solved, 'benchmark_solved', total);
  const core = {
    schema: RSI_CLADE_NODE_SCHEMA,
    version: 1,
    node_id: boundedId(node_id, 'node_id'),
    candidate_id: candidateId(candidate_id, 'node'),
    candidate_sha: exactSha(candidate_sha, 'node'),
    parent_candidate_id: parent_candidate_id == null ? null : candidateId(parent_candidate_id, 'parent'),
    benchmark_solved: solved,
    benchmark_total: total,
    benchmark_score: solved / total,
    evaluation_digest: exactDigest(evaluation_digest, 'evaluation'),
    expansion_count: nonNegativeInt(expansion_count, 'expansion_count', 1_000_000),
    external_evaluator: true,
    authored_by_candidate: false,
    direct_score_is_expansion_authority: false,
    candidate_can_edit_clade_statistics: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, node_digest: digest(core) });
}

export function verifyRsiCladeNode(node) {
  if (!plainObject(node) || node.schema !== RSI_CLADE_NODE_SCHEMA || node.version !== 1) throw new Error('rsi_clade_node_invalid');
  assertZeroAuthority(node, 'node');
  if (
    node.external_evaluator !== true
    || node.authored_by_candidate !== false
    || node.direct_score_is_expansion_authority !== false
    || node.candidate_can_edit_clade_statistics !== false
  ) throw new Error('rsi_clade_node_policy_invalid');
  const canonical = createRsiCladeNode({
    node_id: node.node_id,
    candidate_id: node.candidate_id,
    candidate_sha: node.candidate_sha,
    parent_candidate_id: node.parent_candidate_id,
    benchmark_solved: node.benchmark_solved,
    benchmark_total: node.benchmark_total,
    evaluation_digest: node.evaluation_digest,
    expansion_count: node.expansion_count,
    external_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.node_digest !== exactDigest(node.node_digest, 'node')) throw new Error('rsi_clade_node_digest_mismatch');
  return canonical;
}

function validateTree(nodes) {
  const byCandidate = new Map(nodes.map((node) => [node.candidate_id, node]));
  for (const node of nodes) {
    if (node.parent_candidate_id != null && !byCandidate.has(node.parent_candidate_id)) throw new Error('rsi_clade_parent_missing');
    if (node.parent_candidate_id === node.candidate_id) throw new Error('rsi_clade_self_parent_forbidden');
  }
  // Detect cycles before asserting the existence of a root. A closed cycle has no
  // root by construction, but the more specific evidence is the cycle itself.
  // This also keeps malformed ancestry diagnostics deterministic for callers.
  for (const node of nodes) {
    const seen = new Set([node.candidate_id]);
    let current = node;
    while (current.parent_candidate_id != null) {
      if (seen.has(current.parent_candidate_id)) throw new Error('rsi_clade_cycle_forbidden');
      seen.add(current.parent_candidate_id);
      current = byCandidate.get(current.parent_candidate_id);
    }
  }
  const roots = nodes.filter((node) => node.parent_candidate_id == null);
  if (roots.length < 1) throw new Error('rsi_clade_root_missing');
}

export function createRsiCladeArchive({ archive_id, nodes } = {}) {
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > MAX_NODES) throw new Error('rsi_clade_archive_nodes_invalid');
  const normalized = nodes.map(verifyRsiCladeNode);
  const ids = new Set();
  const candidates = new Set();
  for (const node of normalized) {
    if (ids.has(node.node_id)) throw new Error('rsi_clade_node_id_duplicate');
    if (candidates.has(node.candidate_id)) throw new Error('rsi_clade_candidate_duplicate');
    ids.add(node.node_id);
    candidates.add(node.candidate_id);
  }
  validateTree(normalized);
  const core = {
    schema: RSI_CLADE_ARCHIVE_SCHEMA,
    version: 1,
    archive_id: boundedId(archive_id, 'archive_id'),
    nodes: normalized.sort((a,b)=>a.candidate_id.localeCompare(b.candidate_id)),
    node_count: normalized.length,
    direct_score_is_not_metaproductivity: true,
    clade_statistics_external_only: true,
    candidate_can_edit_archive: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, archive_digest: digest(core) });
}

export function verifyRsiCladeArchive(archive) {
  if (!plainObject(archive) || archive.schema !== RSI_CLADE_ARCHIVE_SCHEMA || archive.version !== 1) throw new Error('rsi_clade_archive_invalid');
  assertZeroAuthority(archive, 'archive');
  if (
    archive.direct_score_is_not_metaproductivity !== true
    || archive.clade_statistics_external_only !== true
    || archive.candidate_can_edit_archive !== false
  ) throw new Error('rsi_clade_archive_policy_invalid');
  const canonical = createRsiCladeArchive({ archive_id: archive.archive_id, nodes: archive.nodes });
  if (canonical.archive_digest !== exactDigest(archive.archive_digest, 'archive')) throw new Error('rsi_clade_archive_digest_mismatch');
  return canonical;
}

function descendantsOf(candidate, children) {
  const out = [];
  const queue = [...(children.get(candidate) || [])];
  while (queue.length) {
    const next = queue.shift();
    out.push(next);
    queue.push(...(children.get(next.candidate_id) || []));
  }
  return out;
}

export function createRsiCladeMetaproductivitySnapshot({ archive } = {}) {
  const checked = verifyRsiCladeArchive(archive);
  const children = new Map();
  for (const node of checked.nodes) {
    if (node.parent_candidate_id == null) continue;
    const rows = children.get(node.parent_candidate_id) || [];
    rows.push(node);
    children.set(node.parent_candidate_id, rows);
  }

  const rows = checked.nodes.map((node) => {
    const descendants = descendantsOf(node.candidate_id, children);
    const solved = descendants.reduce((sum,row)=>sum+row.benchmark_solved,0);
    const total = descendants.reduce((sum,row)=>sum+row.benchmark_total,0);
    const alpha = 1 + solved;
    const beta = 1 + Math.max(0, total - solved);
    const posteriorMean = alpha / (alpha + beta);
    const posteriorVariance = (alpha * beta) / (((alpha + beta) ** 2) * (alpha + beta + 1));
    return Object.freeze({
      candidate_id: node.candidate_id,
      candidate_sha: node.candidate_sha,
      direct_benchmark_score: node.benchmark_score,
      descendant_count: descendants.length,
      descendant_benchmark_solved: solved,
      descendant_benchmark_total: total,
      cmp_proxy_posterior_alpha: alpha,
      cmp_proxy_posterior_beta: beta,
      cmp_proxy_mean: posteriorMean,
      cmp_proxy_variance: posteriorVariance,
      expansion_count: node.expansion_count,
      true_cmp_oracle_available: false,
      clade_metaproductivity_proxy_only: true,
      direct_score_is_expansion_authority: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }).sort((a,b)=>a.candidate_id.localeCompare(b.candidate_id));

  const core = {
    schema: RSI_CLADE_METAPRODUCTIVITY_SNAPSHOT_SCHEMA,
    version: 1,
    archive_id: checked.archive_id,
    archive_digest: checked.archive_digest,
    rows,
    estimator: 'DESCENDANT_BETA_POSTERIOR_PROXY_V1',
    hgm_inspired_clade_guidance: true,
    true_cmp_oracle_available: false,
    metaproductivity_performance_mismatch_explicit: true,
    direct_benchmark_score_not_primary_expansion_signal: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, snapshot_digest: digest(core) });
}

export function verifyRsiCladeMetaproductivitySnapshot(snapshot, archive) {
  if (!plainObject(snapshot) || snapshot.schema !== RSI_CLADE_METAPRODUCTIVITY_SNAPSHOT_SCHEMA || snapshot.version !== 1) throw new Error('rsi_clade_snapshot_invalid');
  assertZeroAuthority(snapshot, 'snapshot');
  if (
    snapshot.estimator !== 'DESCENDANT_BETA_POSTERIOR_PROXY_V1'
    || snapshot.hgm_inspired_clade_guidance !== true
    || snapshot.true_cmp_oracle_available !== false
    || snapshot.metaproductivity_performance_mismatch_explicit !== true
    || snapshot.direct_benchmark_score_not_primary_expansion_signal !== true
  ) throw new Error('rsi_clade_snapshot_policy_invalid');
  const canonical = createRsiCladeMetaproductivitySnapshot({ archive });
  if (canonical.snapshot_digest !== exactDigest(snapshot.snapshot_digest, 'snapshot')) throw new Error('rsi_clade_snapshot_digest_mismatch');
  return canonical;
}

function seededRng(seed) {
  const hex=crypto.createHash('sha256').update(seed,'utf8').digest('hex');
  let state=Number.parseInt(hex.slice(0,8),16)>>>0;
  if(state===0) state=0x9e3779b9;
  return ()=>{
    state^=state<<13; state^=state>>>17; state^=state<<5; state>>>=0;
    return (state+1)/4294967297;
  };
}

function normal(rng) {
  const u1=Math.max(1e-12,rng()), u2=rng();
  return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
}

function gamma(shape,rng) {
  if(shape<1) return gamma(shape+1,rng)*Math.pow(rng(),1/shape);
  const d=shape-1/3, c=1/Math.sqrt(9*d);
  for(let i=0;i<10000;i+=1){
    const x=normal(rng); let v=1+c*x; if(v<=0) continue; v*=v*v;
    const u=rng();
    if(u<1-0.0331*x**4) return d*v;
    if(Math.log(u)<0.5*x*x+d*(1-v+Math.log(v))) return d*v;
  }
  throw new Error('rsi_clade_sampling_failed');
}

function betaSample(alpha,beta,seed){
  const rng=seededRng(seed);
  const x=gamma(alpha,rng), y=gamma(beta,rng);
  return x/(x+y);
}

export function createRsiCladeExpansionPlan({
  snapshot,
  archive,
  expansion_slots,
  evaluation_slots,
  round_id,
} = {}) {
  const checkedArchive=verifyRsiCladeArchive(archive);
  const checked=verifyRsiCladeMetaproductivitySnapshot(snapshot,checkedArchive);
  const expandSlots=positiveInt(expansion_slots,'expansion_slots',MAX_SLOTS);
  const evalSlots=nonNegativeInt(evaluation_slots,'evaluation_slots',MAX_SLOTS);
  const roundId=boundedId(round_id,'round_id');
  const seed=digest({snapshot:checked.snapshot_digest,round_id:roundId,expansion_slots:expandSlots,evaluation_slots:evalSlots});

  const sampled=checked.rows.map(row=>Object.freeze({
    ...row,
    cmp_proxy_sample: betaSample(row.cmp_proxy_posterior_alpha,row.cmp_proxy_posterior_beta,`${seed}:${row.candidate_id}`),
  }));
  const expansion=sampled
    .slice()
    .sort((a,b)=>b.cmp_proxy_sample-a.cmp_proxy_sample || a.expansion_count-b.expansion_count || a.candidate_id.localeCompare(b.candidate_id))
    .slice(0,Math.min(expandSlots,sampled.length))
    .map(row=>Object.freeze({
      candidate_id:row.candidate_id,
      candidate_sha:row.candidate_sha,
      cmp_proxy_sample:row.cmp_proxy_sample,
      direct_benchmark_score:row.direct_benchmark_score,
      descendant_count:row.descendant_count,
      state:'PROPOSE_EXPANSION',
      scheduler_action_authorized:false,
      expansion_is_promotion:false,
    }));

  const evaluation=sampled
    .slice()
    .sort((a,b)=>b.cmp_proxy_variance-a.cmp_proxy_variance || a.descendant_count-b.descendant_count || a.candidate_id.localeCompare(b.candidate_id))
    .slice(0,Math.min(evalSlots,sampled.length))
    .map(row=>Object.freeze({
      candidate_id:row.candidate_id,
      candidate_sha:row.candidate_sha,
      cmp_proxy_variance:row.cmp_proxy_variance,
      descendant_count:row.descendant_count,
      state:'PROPOSE_ADDITIONAL_EXTERNAL_EVALUATION',
      scheduler_action_authorized:false,
      evaluation_is_promotion:false,
    }));

  const core={
    schema:RSI_CLADE_EXPANSION_PLAN_SCHEMA,
    version:1,
    round_id:roundId,
    archive_digest:checkedArchive.archive_digest,
    snapshot_digest:checked.snapshot_digest,
    seed_digest:seed,
    expansion_targets:expansion,
    evaluation_targets:evaluation,
    expansion_and_evaluation_decoupled:true,
    seeded_thompson_sampling_on_clade_proxy:true,
    direct_score_not_primary_expansion_signal:true,
    uncertainty_guides_additional_evaluation:true,
    true_cmp_oracle_claimed:false,
    scheduler_action_authorized:false,
    candidate_can_select_itself:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiCladeExpansionPlan(plan,snapshot,archive){
  if(!plainObject(plan)||plan.schema!==RSI_CLADE_EXPANSION_PLAN_SCHEMA||plan.version!==1) throw new Error('rsi_clade_expansion_plan_invalid');
  assertZeroAuthority(plan,'expansion_plan');
  if(
    plan.expansion_and_evaluation_decoupled!==true
    ||plan.seeded_thompson_sampling_on_clade_proxy!==true
    ||plan.direct_score_not_primary_expansion_signal!==true
    ||plan.uncertainty_guides_additional_evaluation!==true
    ||plan.true_cmp_oracle_claimed!==false
    ||plan.scheduler_action_authorized!==false
    ||plan.candidate_can_select_itself!==false
  ) throw new Error('rsi_clade_expansion_plan_policy_invalid');
  const checkedArchive=verifyRsiCladeArchive(archive);
  const checkedSnapshot=verifyRsiCladeMetaproductivitySnapshot(snapshot,checkedArchive);
  if(plan.archive_digest!==checkedArchive.archive_digest||plan.snapshot_digest!==checkedSnapshot.snapshot_digest) throw new Error('rsi_clade_expansion_plan_binding_mismatch');
  for(const row of [...(plan.expansion_targets||[]),...(plan.evaluation_targets||[])]){
    if(row.scheduler_action_authorized!==false) throw new Error('rsi_clade_expansion_plan_scheduler_authority_invalid');
  }
  const clone=structuredClone(plan); delete clone.plan_digest;
  if(exactDigest(plan.plan_digest,'expansion_plan')!==digest(clone)) throw new Error('rsi_clade_expansion_plan_digest_mismatch');
  return plan;
}

export function rsiCladeMetaproductivityTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.clade-metaproductivity-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-clade-metaproductivity.mjs',
    estimator:'DESCENDANT_BETA_POSTERIOR_PROXY_V1',
    hgm_inspired:true,
    true_cmp_oracle_available:false,
    metaproductivity_performance_mismatch_explicit:true,
    seeded_thompson_sampling_on_clade_proxy:true,
    expansion_and_evaluation_decoupled:true,
    direct_score_is_expansion_authority:false,
    candidate_can_edit_clade_statistics:false,
    scheduler_action_authorized:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,clade_root_digest:digest(root)});
}
