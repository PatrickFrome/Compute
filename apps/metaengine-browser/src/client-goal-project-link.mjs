import { normalizeClientGoalRequestId } from './client-control-contract.mjs';

/** Register only a read-back-confirmed admission. The original goal is never
 * sent again: a lost metadata receipt is recovered by its stable request ID. */
export async function ensureClientGoalProject({ journal, supervisor, request_id }) {
  const requestId = normalizeClientGoalRequestId(request_id);
  const entry = journal.get(requestId);
  if (!entry) throw new Error('client_goal_project_request_missing');
  if (entry.project) return entry.project;
  const task = entry.receipt?.task_id || (entry.progress?.found === true ? entry.progress.task_id : null);
  if (!task) return null;
  try {
    if (typeof supervisor?.projectRegister !== 'function') throw new Error('client_goal_project_registration_unavailable');
    const registration = await supervisor.projectRegister({ request_id: requestId });
    return (await journal.recordProject(registration)).project;
  } catch (error) {
    // Admission and execution state remain intact even when metadata fails.
    await journal.recordProjectError(requestId, error).catch(() => {});
    return null;
  }
}
