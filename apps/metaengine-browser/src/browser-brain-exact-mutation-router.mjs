import { nativeActionRequiresEffectBinding } from './native-effect-binding.mjs';

export const BROWSER_BRAIN_EXACT_MUTATION_ROUTER_SCHEMA = 'metaengine.browser.brain-exact-mutation-router.v1';

const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;

function exactTabId(command) {
  const tabId = String(command?.payload?.tab_id || '').toLowerCase();
  if (!TAB_ID_RE.test(tabId)) throw new Error('browser_exact_mutation_router_explicit_tab_required');
  return tabId;
}

function exactAction(command) {
  const action = String(command?.action || '').trim().toUpperCase();
  if (!nativeActionRequiresEffectBinding(action)) throw new Error('browser_exact_mutation_router_action_not_mutating');
  return action;
}

export class BrowserBrainExactMutationRouter {
  #runtimeControlPlane;
  #resolveWebContentsByTab;
  #executeEffect;
  #activeCells = new Set();

  constructor({ runtimeControlPlane, resolveWebContentsByTab, executeEffect } = {}) {
    if (!runtimeControlPlane || typeof runtimeControlPlane.prepareMutation !== 'function' || typeof runtimeControlPlane.assertMutationTarget !== 'function') {
      throw new Error('browser_exact_mutation_router_runtime_control_plane_required');
    }
    if (typeof resolveWebContentsByTab !== 'function') throw new Error('browser_exact_mutation_router_tab_resolver_required');
    if (typeof executeEffect !== 'function') throw new Error('browser_exact_mutation_router_executor_required');
    this.#runtimeControlPlane = runtimeControlPlane;
    this.#resolveWebContentsByTab = resolveWebContentsByTab;
    this.#executeEffect = executeEffect;
  }

  async route(command) {
    const action = exactAction(command);
    const tabId = exactTabId(command);
    const normalizedCommand = Object.freeze({
      ...command,
      action,
      payload: Object.freeze({ ...(command?.payload || {}), tab_id: tabId }),
    });

    // prepareMutation binds command -> tab -> BrowserCell/binding generation ->
    // renderer process identity -> real CDP target. It is deliberately called
    // before touching the physical WebContents and cannot choose selected or
    // provider/platform fallback targets.
    const fence = this.#runtimeControlPlane.prepareMutation(normalizedCommand);
    const cellKey = String(fence?.cell_id || `tab:${tabId}`);
    if (this.#activeCells.has(cellKey)) throw new Error('browser_exact_mutation_router_cell_busy');
    this.#activeCells.add(cellKey);

    try {
      const webContents = this.#resolveWebContentsByTab(tabId);
      if (!webContents) throw new Error('browser_exact_mutation_router_target_unavailable');

      // This is the final authority check. No await is allowed between this
      // assertion and executeEffect so a renderer/target generation cannot be
      // silently replaced by a selected/platform fallback in this router.
      const validatedFence = this.#runtimeControlPlane.assertMutationTarget({
        command: normalizedCommand,
        fence,
        webContents,
      });
      const result = await this.#executeEffect({
        command: normalizedCommand,
        tab_id: tabId,
        webContents,
        fence: validatedFence,
      });
      return Object.freeze({
        ok: true,
        action,
        tab_id: tabId,
        cell_id: fence?.cell_id || null,
        binding_generation: fence?.binding_generation ?? null,
        target_id: fence?.target_id || null,
        result,
        automatic_retry_allowed: false,
        selected_tab_fallback_allowed: false,
        platform_fallback_allowed: false,
        authority_effect: true,
      });
    } finally {
      this.#activeCells.delete(cellKey);
    }
  }

  snapshot() {
    return Object.freeze({
      schema: BROWSER_BRAIN_EXACT_MUTATION_ROUTER_SCHEMA,
      active_cell_count: this.#activeCells.size,
      active_cells: Object.freeze([...this.#activeCells]),
      concurrency_scope: 'BROWSERCELL',
      independent_cells_parallel: true,
      same_cell_overlap_allowed: false,
      selected_tab_fallback_allowed: false,
      platform_fallback_allowed: false,
      automatic_retry_allowed: false,
      second_scheduler: false,
      polling_loop: false,
      command_leasing: false,
      authority_effect: false,
    });
  }
}
