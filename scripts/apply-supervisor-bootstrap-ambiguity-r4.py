from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


keepalive_path = Path("apps/metaengine-browser/src/supervisor-keepalive.mjs")
keepalive = keepalive_path.read_text()
keepalive_marker = "  async retireAmbiguousAfterTerminal({ tab_id = null, generation_epoch = null, reason = 'TERMINAL_BOUNDARY_CONFIRMED' } = {}) {"
keepalive_method = '''  async markAmbiguousContinuationAttempt({ wake_id = null, tab_id = null, composer_sha256 = null } = {}) {
    const pending = this.#state.pending_wake;
    if (this.#state.state !== 'WAKE_AMBIGUOUS' || !pending?.ambiguous_at) return false;
    if (pending.wake_id !== String(wake_id || '')) throw new Error('keepalive_wake_binding_mismatch');
    if (pending.ambiguity_continuation_attempted_at) return false;
    const tabId = String(tab_id || '');
    const composerSha = String(composer_sha256 || '').toLowerCase();
    if (!tabId || !/^[a-f0-9]{64}$/.test(composerSha)) return false;
    pending.ambiguity_continuation_attempted_at = iso(this.#clock);
    pending.ambiguity_continuation_tab_id = tabId;
    pending.ambiguity_continuation_composer_sha256 = composerSha;
    pending.automatic_retry_allowed = false;
    await this.#persist();
    return true;
  }

'''
keepalive = replace_once(keepalive, keepalive_marker, keepalive_method + keepalive_marker, "keepalive insertion")
keepalive_path.write_text(keepalive)

core_path = Path("apps/metaengine-browser/src/supervisor-lifecycle-runtime-core.mjs")
core = core_path.read_text()
old_recovery = '''    if (row.terminal_ready === true && composerMatches(frame, message) && this.#canActuate() === true) {
      const send = uniqueChatGptControl(frame, 'SEND');
      if (!send) return false;
      await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: String(tab.tab_id), role: 'button', accessible_name: send.name, semantic_ref: send.semantic_ref }, platform: null });
      const readback = await this.#observeSendReadback(tab.tab_id, pending.wake_id);
      if (readback.ok) {
        await this.#keepalive.resolveAmbiguous({ observed_sent: true });
        this.#activateRequest(pending, tab.tab_id, true);
        this.#lastRecovery = {
          action: 'RESTART_TYPED_WAKE_SEND_RECOVERED', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
          proof: 'EXACT_COMPOSER_SHA256_THEN_POSITIVE_SEND_READBACK', confirmed: true, ambiguous: false,
          prompt_retyped: false, automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
        };
        return true;
      }
      this.#lastRecovery = {
        action: 'RESTART_TYPED_WAKE_SEND_AMBIGUOUS', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
        proof: 'EXACT_COMPOSER_SHA256_BEFORE_SINGLE_CLICK', confirmed: false, ambiguous: true,
        prompt_retyped: false, automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    }
'''
new_recovery = '''    const composer = unique(frame, 'textbox');
    if (row.terminal_ready === true
      && composer?.value_sha256 === sha256(message)
      && this.#canActuate() === true) {
      const send = uniqueChatGptControl(frame, 'SEND');
      if (!send) return false;
      const continuationArmed = await this.#keepalive.markAmbiguousContinuationAttempt({
        wake_id: pending.wake_id,
        tab_id: tab.tab_id,
        composer_sha256: composer.value_sha256,
      });
      if (!continuationArmed) return false;
      await this.#execute({ action: 'TYPED_CLICK', payload: { tab_id: String(tab.tab_id), role: 'button', accessible_name: send.name, semantic_ref: send.semantic_ref }, platform: null });
      const readback = await this.#observeSendReadback(tab.tab_id, pending.wake_id);
      if (readback.ok) {
        await this.#keepalive.resolveAmbiguous({ observed_sent: true });
        this.#activateRequest(pending, tab.tab_id, true);
        this.#lastRecovery = {
          action: 'RESTART_TYPED_WAKE_SEND_RECOVERED', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
          proof: 'DURABLE_SINGLE_CONTINUATION_FENCE_THEN_POSITIVE_SEND_READBACK', confirmed: true, ambiguous: false,
          prompt_retyped: false, automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
        };
        return true;
      }
      this.#lastRecovery = {
        action: 'RESTART_TYPED_WAKE_SEND_AMBIGUOUS', wake_id: pending.wake_id, tab_id: String(tab.tab_id),
        proof: 'DURABLE_SINGLE_CONTINUATION_FENCE_BEFORE_CLICK', confirmed: false, ambiguous: true,
        prompt_retyped: false, automatic_retry_allowed: false, at: new Date().toISOString(), authority_effect: false,
      };
      return true;
    }
'''
core = replace_once(core, old_recovery, new_recovery, "ambiguous wake recovery")

supervisor_marker = "      let supervisor = await this.#supervisorTab(state);"
bootstrap_reconcile = '''      let keepalive = this.#keepalive.snapshot();
      if (keepalive.state === 'WAKE_AMBIGUOUS'
        && keepalive.pending_wake?.ambiguous_at
        && !keepalive.conversation_url) {
        const fleetTabs = new Set((state?.fleet?.agents || []).map((a) => a?.tab_id).filter(Boolean).map(String));
        const bootstrapCandidates = (state?.tabs || []).filter((tab) => {
          if (fleetTabs.has(String(tab?.tab_id || ''))) return false;
          const url = String(tab?.url || '');
          return CHAT_ROOT_RE.test(url) || CHAT_RE.test(url);
        });
        const durableTabId = String(
          keepalive.pending_wake?.ambiguity_continuation_tab_id
          || keepalive.tab_id
          || '',
        );
        const scopedCandidates = durableTabId
          ? bootstrapCandidates.filter((tab) => String(tab?.tab_id || '') === durableTabId)
          : bootstrapCandidates;

        if (scopedCandidates.length === 1) {
          const bootstrapTab = scopedCandidates[0];
          try {
            const frame = await this.#capture(bootstrapTab.tab_id);
            const frameUrl = String(frame?.url || bootstrapTab?.url || '');
            if (CHAT_ROOT_RE.test(frameUrl) || CHAT_RE.test(frameUrl)) {
              const live = tabLiveness(state, bootstrapTab.tab_id);
              const row = this.#sessionMonitor.observe({ tab_id: bootstrapTab.tab_id, frame, ...live });
              this.#lastSupervisorGeneration = row.state;
              await this.#recoverAmbiguousWakeFromFrame(bootstrapTab, frame, row, keepalive);
              keepalive = this.#keepalive.snapshot();
              if (keepalive.state !== 'WAKE_AMBIGUOUS' && keepalive.active_wake) {
                let reboundFrame = frame;
                if (!CHAT_RE.test(String(reboundFrame?.url || ''))) {
                  try { reboundFrame = await this.#capture(bootstrapTab.tab_id); } catch {}
                }
                const reboundUrl = String(reboundFrame?.url || '');
                if (CHAT_RE.test(reboundUrl)) {
                  await this.#keepalive.bindConversation({ url: reboundUrl, tab_id: bootstrapTab.tab_id });
                  keepalive = this.#keepalive.snapshot();
                }
              }
            }
          } catch (e) {
            this.#lastError = `bootstrap_ambiguous_reconcile:${String(e?.message || e).slice(0, 200)}`;
          }
        }

        keepalive = this.#keepalive.snapshot();
        if (keepalive.state === 'WAKE_AMBIGUOUS') return this.snapshot();
        if (keepalive.active_wake && !keepalive.conversation_url) return this.snapshot();
        state = await this.#getState();
      }
'''
core = replace_once(core, supervisor_marker, bootstrap_reconcile + supervisor_marker, "cycle bootstrap reconciliation")
core_path.write_text(core)
