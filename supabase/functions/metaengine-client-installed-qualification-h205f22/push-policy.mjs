// Called only after GitHub JWT signature/issuer/audience verification.
// Pure tuple validation; no enrollment, database or network authority.
export function assertInstalledQualificationPushBinding(payload, run, sourceHead) {
  const repository = 'PatrickFrome/Compute';
  const workflow = '.github/workflows/browser-windows-installed-chat-qualification.yml';
  const release = 'release/self-update-ambiguity-live-v2';
  const physical = 'physical/build-slsa-provenance-v1';
  const ref = String(payload?.ref || '');
  const branch = ref === `refs/heads/${release}` ? release
    : ref === `refs/heads/${physical}` ? physical : null;
  if (!branch || payload?.event_name !== 'push'
      || ![`repo:${repository}:ref:${ref}`, `repo:PatrickFrome@20597814/Compute@1341371143:ref:${ref}`].includes(payload?.sub)) {
    throw new Error('push_event_or_subject_forbidden');
  }
  if (payload.repository !== repository || String(payload.repository_id) !== '1341371143'
      || String(payload.repository_owner_id) !== '20597814'
      || payload.runner_environment !== 'github-hosted') throw new Error('push_identity_forbidden');
  if (!/^[a-f0-9]{40}$/.test(sourceHead)
      || payload.sha !== sourceHead || payload.workflow_sha !== sourceHead
      || payload.workflow_ref !== `${repository}/${workflow}@${ref}`) {
    throw new Error('push_workflow_source_binding_invalid');
  }
  if (run?.event !== 'push' || run.head_branch !== branch
      || run.path !== workflow || run.head_sha !== sourceHead
      || run.repository?.full_name !== repository
      || String(run.id) !== String(payload.run_id)
      || !/^[1-9][0-9]*$/.test(String(payload.run_id))
      || !Number.isSafeInteger(Number(payload.run_attempt)) || Number(payload.run_attempt) < 1
      || Number(run.run_attempt) !== Number(payload.run_attempt)) {
    throw new Error('push_run_binding_invalid');
  }
  if (branch === physical && Number(payload.run_attempt) !== 1) {
    throw new Error('physical_qualification_rerun_forbidden');
  }
  return Object.freeze({ branch, ref, source_head: sourceHead, authority_effect: false });
}
