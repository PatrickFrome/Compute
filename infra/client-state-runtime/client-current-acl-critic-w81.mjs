// W81: independent, fail-closed classification of an *untrusted* Node TAP receipt.
// The caller must separately verify GitHub event, job, exact SHA and log origin.
// This proves test execution shape only; no installed Owner/ACL/live authority.
const SHA=/^[a-f0-9]{40}$/;
export const W81_REQUIRED_WINDOWS_ACL_CASES=Object.freeze({
  positive_ntfs:'Windows physically protected disposable directory and file permit native ACL readback',
  inherited_acl:'Windows inherited file DACL fails, even if inherited principals are otherwise allowed',
  broad_sid:'Windows broad Everyone read ACE fails native policy',
  root_broad_sid:'Windows root broad read ACE fails even when archive DACL remains private',
  file_id_toctou:'Windows native identity substitution between descriptor reads fails closed',
  file_symlink:'Windows reparse file or path root is rejected',
  junction_root:'Windows junction reparse root cannot alias a protected archive',
  hardlink_file_id:'Windows hardlink aliases cannot qualify single-link archive file identity',
  untrusted_paths:'UNC, ADS, alternate archive root and path traversal never qualify',
  owner_generation:'Windows Owner generation changes across two native ACL samples and remains UNKNOWN',
  archive_digest:'matching receipt cannot conceal modified archive bytes',
  restore_gate:'TOC-qualified archive without full disposable restore is NOT restore-qualified',
});
export function reviewW81WindowsNativeAclTap(input={}) {
  const x=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const reasons=[];
  if(x.platform!=='win32')reasons.push('WINDOWS_NTFS_NOT_EXECUTED');
  if(!SHA.test(x.expected_sha||'')||x.checked_out_sha!==x.expected_sha
      ||x.clean_checkout!==true)reasons.push('EXACT_CLEAN_SOURCE_UNPROVEN');
  // This is deliberately not a log signature; untrusted pages cannot turn a
  // self-asserted TAP into authentic CI. Independent authenticated job readback
  // is required even when every receipt line looks successful.
  const tap=typeof x.tap==='string'&&x.tap.length<=2_000_000?x.tap:'';
  if(!tap||tap.split('\n').length>50_000)reasons.push('TAP_MISSING_OR_UNBOUNDED');
  const outcomes=new Map();
  if(tap)for(const line of tap.split(/\r?\n/)){
    const m=/^(ok|not ok)\s+\d+\s+-\s+(.+)$/.exec(line);
    if(!m)continue;
    const name=m[2].replace(/\s+#\s+(?:SKIP|TODO)\b.*$/,'').trim();
    const skipped=/\s+#\s+(?:SKIP|TODO)\b/.test(m[2]);
    const state=skipped?'SKIPPED':m[1]==='ok'?'PASS':'FAIL';
    const found=outcomes.get(name)||[];
    found.push(state);outcomes.set(name,found);
  }
  const gates={};
  for(const [gate,name] of Object.entries(W81_REQUIRED_WINDOWS_ACL_CASES)){
    const states=outcomes.get(name)||[];
    gates[gate]=states.length===1?states[0]:'UNKNOWN';
    if(states.length!==1)reasons.push('MISSING_OR_DUPLICATED_'+gate.toUpperCase());
    else if(states[0]!=='PASS')reasons.push('NOT_EXECUTED_PASS_'+gate.toUpperCase());
  }
  // A single skipped privileged symlink is NOT redeemed by executed junction
  // and hardlink aliases: each separate negative keeps its own status.
  if(gates.file_symlink!=='PASS')reasons.push('PRIVILEGED_SYMLINK_PROOF_UNKNOWN');
  return Object.freeze({
    schema:'metaengine.client.acl-native-tap-critic.w81.v1',
    state:reasons.length?'BLOCKED':'REVIEW_REQUIRED',
    reasons:Object.freeze([...new Set(reasons)]),
    gates:Object.freeze(gates),
    evidence_class:'UNTRUSTED_SOURCE_STAGING_TEST_RECEIPT',
    original_report_verified:false,source_accepted:false,
    installed_owner_proven:false,physical_pg_restore_proven:false,
    can_merge:false,can_install:false,live_accepted:false,
    authority_effect:false,automatic_retry_allowed:false,hosted_fallback_allowed:false,
  });
}
