const clipError = (error) => String(error?.message || error || 'unknown_error').slice(0, 240);

/**
 * Reconcile TabRegistry when Electron proves that a WebContents has been destroyed.
 *
 * ExactBrowserTabViewMap already drops the physical view binding on the same
 * Electron event. This companion closes the logical registry row so signed
 * supervisor state cannot advertise a tab that no longer has a physical
 * WebContentsView. The operation is idempotent: an explicit closeTab() may
 * have retired the registry row first, in which case this becomes a no-op.
 */
export async function reconcileDestroyedTabView({
  tabId,
  registry,
  fleet = null,
  invalidatePerception = null,
  attachSelected = null,
  publishSnapshot = null,
  reason = 'PHYSICAL_WEBCONTENTS_DESTROYED',
} = {}) {
  const id = String(tabId || '');
  if (!id) throw new Error('tab_view_lifecycle_tab_id_required');
  if (!registry || typeof registry.close !== 'function') throw new Error('tab_view_lifecycle_registry_required');

  const removed = registry.close(id);
  if (!removed) {
    return Object.freeze({
      schema: 'metaengine.browser.tab-view-destroy-reconciliation.v1',
      tab_id: id,
      reconciled: false,
      registry_already_absent: true,
      fleet_notified: false,
      projection_published: false,
      authority_effect: false,
    });
  }

  // Local UI/perception state follows the proven physical destruction
  // immediately. Downstream persistence/observation failures must not resurrect
  // the already-dead WebContents or the just-retired registry row.
  try { invalidatePerception?.(id); } catch {}
  try { attachSelected?.(); } catch {}

  let fleetNotified = false;
  let fleetError = null;
  if (typeof fleet?.onTabClosed === 'function') {
    try {
      await fleet.onTabClosed(id, String(reason || 'PHYSICAL_WEBCONTENTS_DESTROYED'));
      fleetNotified = true;
    } catch (error) {
      fleetError = clipError(error);
    }
  }

  let projectionPublished = false;
  let projectionError = null;
  if (typeof publishSnapshot === 'function') {
    try {
      await publishSnapshot();
      projectionPublished = true;
    } catch (error) {
      projectionError = clipError(error);
    }
  }

  return Object.freeze({
    schema: 'metaengine.browser.tab-view-destroy-reconciliation.v1',
    tab_id: id,
    reconciled: true,
    registry_already_absent: false,
    fleet_notified: fleetNotified,
    fleet_error: fleetError,
    projection_published: projectionPublished,
    projection_error: projectionError,
    authority_effect: false,
  });
}
