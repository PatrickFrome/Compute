/**
 * Synchronous, dependency-injected creation boundary for a logical tab and its
 * Electron WebContentsView. This module imports no Electron or application Main.
 *
 * The registry still allocates the canonical tab and BrowserCell identity.
 * Until select/attach returns, failure compensates ONLY that new tab/view;
 * navigation, persistence and publication happen after this boundary and are
 * deliberately not retried or rolled back on an ambiguous external effect.
 */
const fail = reason => { throw new Error('tab_creation_lifecycle_' + reason); };

export function createAttachedTabView({
  registry, views, tabOptions, createView, wireView, attachSelected, detachView,
  select = true,
} = {}) {
  if (!registry || !['create', 'get', 'close', 'select', 'selected'].every(name => typeof registry[name] === 'function')
      || !views || !['get', 'set', 'delete'].every(name => typeof views[name] === 'function')
      || ![createView, wireView, attachSelected, detachView].every(callback => typeof callback === 'function')
      || typeof select !== 'boolean') fail('dependencies_required');

  const priorSelectedId = registry.selected()?.tab_id || null;
  let tab = null;
  let view = null;
  let attachAttempted = false;
  let compensated = false;

  const compensate = () => {
    if (compensated) return [];
    compensated = true;
    const errors = [];
    const attempt = action => { try { action(); } catch (error) { errors.push(error); } };
    const id = tab?.tab_id;
    let selectedBeforeClose = false;
    if (id) attempt(() => { selectedBeforeClose = registry.selected()?.tab_id === id; });

    // Exact object ownership; never unbind a different view installed later.
    if (id && view) attempt(() => {
      if (views.get(id) === view) views.delete(id);
    });

    // Retire the newly allocated canonical BrowserCell/row BEFORE destroying
    // WebContents. Synchronous 'destroyed' listeners then see an absent row,
    // so reconciliation cannot notify the fleet about an uncommitted tab.
    if (id) attempt(() => {
      const current = registry.get(id);
      if (current?.tab_id === id && current.browser_cell_id === tab.browser_cell_id
          && current.browser_cell_generation === tab.browser_cell_generation) registry.close(id);
    });
    if (selectedBeforeClose && priorSelectedId) attempt(() => {
      if (registry.get(priorSelectedId)) registry.select(priorSelectedId);
    });

    // attachSelected may have attached the view before throwing. Detach only
    // the new object, never enumerate/reparent unrelated tabs. Then force its
    // physical disposal exactly once; close() is a fallback for inert shims.
    if (view) {
      if (attachAttempted) attempt(() => detachView(view));
      attempt(() => {
        const contents = view.webContents;
        if (!contents || typeof contents.isDestroyed !== 'function') fail('webcontents_invalid');
        if (contents.isDestroyed()) return;
        if (typeof contents.destroy === 'function') contents.destroy();
        else if (typeof contents.close === 'function') contents.close();
        else fail('webcontents_disposal_unavailable');
      });
    }
    return errors;
  };

  try {
    tab = registry.create(tabOptions);
    if (!tab?.tab_id || !tab.browser_cell_id) fail('registry_return_invalid');
    view = createView();
    if (!view?.webContents || typeof view.webContents.isDestroyed !== 'function'
        || view.webContents.isDestroyed()) fail('view_invalid');
    views.set(tab.tab_id, view);
    wireView(tab, view);
    if (view.webContents.isDestroyed()) fail('view_destroyed_during_wiring');
    if (select) registry.select(tab.tab_id);
    attachAttempted = true;
    attachSelected();
    if (view.webContents.isDestroyed()) fail('view_destroyed_during_attach');
    return Object.freeze({ tab, view });
  } catch (error) {
    const cleanupErrors = compensate();
    if (cleanupErrors.length) {
      throw new AggregateError([error, ...cleanupErrors],
        'tab_creation_lifecycle_compensation_unconfirmed', { cause: error });
    }
    throw error;
  }
}
