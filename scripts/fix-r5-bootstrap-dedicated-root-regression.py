from pathlib import Path

p = Path('apps/metaengine-browser/src/supervisor-lifecycle-runtime-core.mjs')
text = p.read_text(encoding='utf-8')
old = """    let prepared = null;
    try {
      const current = await this.#getState();
      const fleetTabs = new Set((current?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
      const reusableRoots = (current?.tabs || []).filter((candidate) => (
        !fleetTabs.has(String(candidate?.tab_id || ''))
        && CHAT_ROOT_RE.test(String(candidate?.url || ''))
      ));
      const preferredId = String(preferredExistingRootTabId || '');
      const scopedRoots = preferredId
        ? reusableRoots.filter((candidate) => String(candidate?.tab_id || '') === preferredId)
        : reusableRoots;
      if ((preferredId && scopedRoots.length !== 1) || (!preferredId && scopedRoots.length > 1)) {
        this.#lastError = 'supervisor_bootstrap_pre_effect:BOOTSTRAP_ROOT_AMBIGUOUS';
        return false;
      }
      let tab = scopedRoots[0] || null;
      if (!tab) {
        tab = await this.#execute({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
      }
      if (!tab?.tab_id) throw new Error('supervisor_bootstrap_tab_creation_no_readback');
      const ready = await this.#waitForBootstrapRoot(tab.tab_id);
"""
new = """    let prepared = null;
    try {
      const preferredId = String(preferredExistingRootTabId || '');
      let tab = null;
      if (preferredId) {
        const current = await this.#getState();
        const fleetTabs = new Set((current?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
        const scopedRoots = (current?.tabs || []).filter((candidate) => (
          String(candidate?.tab_id || '') === preferredId
          && !fleetTabs.has(String(candidate?.tab_id || ''))
          && CHAT_ROOT_RE.test(String(candidate?.url || ''))
        ));
        if (scopedRoots.length !== 1) {
          this.#lastError = 'supervisor_bootstrap_pre_effect:BOOTSTRAP_ROOT_AMBIGUOUS';
          return false;
        }
        tab = scopedRoots[0];
      } else {
        // Normal first bootstrap retains the dedicated-root invariant. Existing roots
        // are reusable only for the explicit process-boundary recovery path above.
        tab = await this.#execute({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/', select: false }, platform: null });
      }
      if (!tab?.tab_id) throw new Error('supervisor_bootstrap_tab_creation_no_readback');
      const ready = await this.#waitForBootstrapRoot(tab.tab_id);
"""
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one bootstrap block, got {count}')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('fixed R5 dedicated-root bootstrap regression')
