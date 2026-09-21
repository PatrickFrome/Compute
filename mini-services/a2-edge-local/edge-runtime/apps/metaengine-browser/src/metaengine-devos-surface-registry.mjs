import { attachDevOSNativeSurfaces } from './metaengine-devos-native-surfaces.mjs';
import { attachDevOSSourceSurfaces } from './metaengine-devos-source-surfaces.mjs';

export const METAENGINE_DEVOS_SURFACE_INSTANCE_REGISTRY_SCHEMA = 'metaengine.devos.surface-instance-registry.v1';
const MAX_REGISTERED_SURFACES = 1024;

function zeroAuthorityContract() {
  return Object.freeze({
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  });
}

function hasZeroAuthority(value) {
  return value
    && value.projection_is_authority === false
    && value.scheduler_authority === false
    && value.execution_authority === false
    && value.command_leasing === false
    && value.automatic_effect_retry_allowed === false
    && value.page_model_authority === false
    && value.authority_effect === false;
}

function text(value, max = 240) {
  const out = String(value ?? '').trim();
  return out ? out.slice(0, max) : null;
}

function invalidRegistry(devos, reason) {
  return Object.freeze({
    ...devos,
    surface_instance_registry: Object.freeze({
      schema: METAENGINE_DEVOS_SURFACE_INSTANCE_REGISTRY_SCHEMA,
      valid: false,
      reason,
      instance_count: 0,
      instances: Object.freeze([]),
      bounded: true,
      max_instances: MAX_REGISTERED_SURFACES,
      ...zeroAuthorityContract(),
    }),
    ...zeroAuthorityContract(),
  });
}

export function finalizeDevOSSurfaceRegistry(devos) {
  if (!devos
    || devos.schema !== 'metaengine.devos.projection.v1'
    || devos.primary_object !== 'SESSION'
    || !hasZeroAuthority(devos)
    || !Array.isArray(devos.sessions)
    || !Array.isArray(devos.surfaces)
    || !devos.surface_registry
    || !Array.isArray(devos.surface_registry.types)) return devos;

  if (devos.surfaces.length > MAX_REGISTERED_SURFACES) return invalidRegistry(devos, 'SURFACE_REGISTRY_CAP_EXCEEDED');
  const allowedTypes = new Set(devos.surface_registry.types.map((row) => text(row?.type, 64)).filter(Boolean));
  const sessions = new Map();
  for (const session of devos.sessions) {
    const sessionId = text(session?.session_id, 200);
    if (!sessionId || sessions.has(sessionId) || !hasZeroAuthority(session)) return invalidRegistry(devos, 'SESSION_IDENTITY_INVALID');
    sessions.set(sessionId, session);
  }

  const byId = new Map();
  const instances = [];
  const countsByType = new Map();
  let runtimeBoundCount = 0;
  let sourceBackedCount = 0;
  for (const surface of devos.surfaces) {
    const surfaceId = text(surface?.surface_id, 240);
    const sessionId = text(surface?.session_id, 200);
    const type = text(surface?.type, 64)?.toUpperCase();
    if (!surfaceId || !sessionId || !type || byId.has(surfaceId) || !sessions.has(sessionId) || !allowedTypes.has(type) || !hasZeroAuthority(surface)) {
      return invalidRegistry(devos, 'SURFACE_INSTANCE_INVALID');
    }
    byId.set(surfaceId, surface);
    countsByType.set(type, (countsByType.get(type) || 0) + 1);
    if (surface.runtime_bound === true || type === 'BROWSER') runtimeBoundCount += 1;
    if (surface.source_backed === true) sourceBackedCount += 1;
    instances.push(Object.freeze({
      surface_id: surfaceId,
      session_id: sessionId,
      type,
      tab_id: text(surface?.tab_id, 160),
      runtime_bound: surface.runtime_bound === true || type === 'BROWSER',
      presentation_only: type === 'BROWSER' ? false : surface.presentation_only !== false,
      source_backed: surface.source_backed === true,
      source: text(surface?.source, 160),
      ...zeroAuthorityContract(),
    }));
  }

  for (const [sessionId, session] of sessions) {
    const ids = Array.isArray(session.surface_ids) ? session.surface_ids.map((value) => text(value, 240)).filter(Boolean) : [];
    if (new Set(ids).size !== ids.length) return invalidRegistry(devos, 'SESSION_SURFACE_DUPLICATE');
    for (const surfaceId of ids) {
      const surface = byId.get(surfaceId);
      if (!surface || surface.session_id !== sessionId) return invalidRegistry(devos, 'SESSION_SURFACE_MEMBERSHIP_INVALID');
    }
    const owned = instances.filter((row) => row.session_id === sessionId).length;
    if (owned !== ids.length) return invalidRegistry(devos, 'SESSION_SURFACE_COVERAGE_INVALID');
  }

  const registry = Object.freeze({
    schema: METAENGINE_DEVOS_SURFACE_INSTANCE_REGISTRY_SCHEMA,
    valid: true,
    reason: null,
    instance_count: instances.length,
    runtime_bound_count: runtimeBoundCount,
    presentation_only_count: instances.length - runtimeBoundCount,
    source_backed_count: sourceBackedCount,
    counts_by_type: Object.freeze(Object.fromEntries([...countsByType.entries()].sort(([a], [b]) => a.localeCompare(b)))),
    instances: Object.freeze(instances),
    bounded: true,
    max_instances: MAX_REGISTERED_SURFACES,
    exact_session_membership_required: true,
    duplicate_surface_ids_allowed: false,
    renderer_registration_allowed: false,
    dynamic_execution_registration_allowed: false,
    ...zeroAuthorityContract(),
  });

  return Object.freeze({
    ...devos,
    surface_registry: Object.freeze({
      ...devos.surface_registry,
      instance_registry_schema: METAENGINE_DEVOS_SURFACE_INSTANCE_REGISTRY_SCHEMA,
      registered_instance_count: instances.length,
      registered_runtime_bound_count: runtimeBoundCount,
      registered_source_backed_count: sourceBackedCount,
      instances_validated: true,
      ...zeroAuthorityContract(),
    }),
    surface_instance_registry: registry,
    ...zeroAuthorityContract(),
  });
}

export function composeDevOSSurfaceRegistry(devos, { source_snapshot = null } = {}) {
  const native = attachDevOSNativeSurfaces(devos);
  const sourced = attachDevOSSourceSurfaces(native, source_snapshot);
  return finalizeDevOSSurfaceRegistry(sourced);
}
