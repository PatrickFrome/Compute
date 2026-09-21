const SUPERVISOR_ID_RE = /^sup_[a-f0-9]{24}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const VALID_STATUS = new Set(['ACTIVE','PAUSED','LOST','AMBIGUOUS_INCARNATION']);

const clean = (value) => String(value ?? '').trim();

export function buildSupervisorMeshWireProjectionV1(runtime, { maxSupervisors = 16 } = {}) {
  if (!runtime || typeof runtime !== 'object' || runtime.authority_effect === true) return null;
  const mesh = runtime.mesh;
  if (!mesh || typeof mesh !== 'object' || mesh.authority_effect === true || !Array.isArray(mesh.supervisors)) return null;
  const limit = Number(maxSupervisors);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) throw new Error('supervisor_mesh_wire_limit_invalid');
  if (mesh.supervisors.length > limit) throw new Error('supervisor_mesh_wire_capacity_exceeded');

  const supervisors = [];
  const seen = new Set();
  for (const row of mesh.supervisors) {
    const supervisorId = clean(row?.supervisor_id).toLowerCase();
    const hash = clean(row?.conversation_url_sha256).toLowerCase();
    const status = clean(row?.status || 'LOST').toUpperCase();
    const tabId = row?.tab_id == null ? null : clean(row.tab_id);
    if (!SUPERVISOR_ID_RE.test(supervisorId) || !HASH_RE.test(hash)) throw new Error('supervisor_mesh_wire_identity_invalid');
    if (supervisorId !== `sup_${hash.slice(0, 24)}`) throw new Error('supervisor_mesh_wire_identity_mismatch');
    if (!VALID_STATUS.has(status) || row?.authority_effect === true) throw new Error('supervisor_mesh_wire_state_invalid');
    if (seen.has(supervisorId)) throw new Error('supervisor_mesh_wire_duplicate_supervisor');
    seen.add(supervisorId);
    supervisors.push(Object.freeze({
      supervisor_id: supervisorId,
      conversation_url_sha256: hash,
      status,
      tab_id: status === 'LOST' || status === 'AMBIGUOUS_INCARNATION' ? null : (tabId || null),
      selected: row?.selected === true,
      authority_effect: false,
    }));
  }

  const preferredRaw = clean(mesh.coordinator_supervisor_id || mesh.preferred_supervisor_id).toLowerCase();
  const preferred = preferredRaw && seen.has(preferredRaw) ? preferredRaw : null;
  return Object.freeze({
    schema: 'metaengine.supervisor-mesh-runtime.v1',
    running: runtime.running === true,
    last_reconcile_at: runtime.last_reconcile_at || null,
    last_error: runtime.last_error ? clean(runtime.last_error).slice(0, 500) : null,
    authority_effect: false,
    mesh: Object.freeze({
      schema: 'metaengine.supervisor-mesh.state.v1',
      version: clean(mesh.version || '1.0.0').slice(0, 32),
      mesh_epoch: Math.max(1, Number(mesh.mesh_epoch) || 1),
      preferred_supervisor_id: preferred,
      supervisors: Object.freeze(supervisors),
      authority_effect: false,
    }),
  });
}
