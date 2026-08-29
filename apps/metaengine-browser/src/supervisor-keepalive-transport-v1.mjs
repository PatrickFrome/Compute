const DEFAULT_STOP_NAMES = Object.freeze(['Stop','Stop generating','Остановить','Остановить создание']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const canonical = (value) => {
  const url = new URL(String(value || ''));
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
};

function exactTarget(frame, role, name) {
  return (frame?.semantic_targets || []).filter((row) => row.role === role && row.name === name);
}

function definitePreActuationError(error) {
  const message = String(error?.message || error);
  return message.includes('native_semantic_target_not_found')
    || message.includes('native_semantic_target_ambiguous')
    || message.includes('native_semantic_target_invalid')
    || message.includes('native_control_webcontents_unavailable');
}

export class NativeSupervisorKeepaliveTransport {
  #resolveBoundView;
  #captureSemanticFrame;
  #executeSemanticCommand;
  #composerRole;
  #composerName;
  #sendRole;
  #sendName;
  #stopNames;
  #readbackDelaysMs;

  constructor({
    resolveBoundView,
    captureSemanticFrame,
    executeSemanticCommand,
    composerRole = 'textbox',
    composerName = '',
    sendRole = 'button',
    sendName = '',
    stopNames = DEFAULT_STOP_NAMES,
    readbackDelaysMs = [120, 300, 700],
  } = {}) {
    if (![resolveBoundView, captureSemanticFrame, executeSemanticCommand].every((fn) => typeof fn === 'function')) throw new Error('keepalive_transport_dependency_invalid');
    this.#resolveBoundView = resolveBoundView;
    this.#captureSemanticFrame = captureSemanticFrame;
    this.#executeSemanticCommand = executeSemanticCommand;
    this.#composerRole = String(composerRole || 'textbox').trim().toLowerCase();
    this.#composerName = String(composerName || '').trim();
    this.#sendRole = String(sendRole || 'button').trim().toLowerCase();
    this.#sendName = String(sendName || '').trim();
    this.#stopNames = new Set((Array.isArray(stopNames) ? stopNames : []).map((x) => String(x).trim()).filter(Boolean));
    this.#readbackDelaysMs = readbackDelaysMs.map(Number).filter((x) => Number.isFinite(x) && x >= 0 && x <= 5000);
  }

  get configured() {
    return Boolean(this.#composerName && this.#sendName);
  }

  async proveIdleComposerReady(binding) {
    if (!this.configured) return {
      ok: false,
      idle: false,
      composer_ready: false,
      unique_composer: false,
      unique_send_control: false,
      authority: 'TRUSTED_NATIVE_SEMANTIC_PROBE',
      reason: 'SEMANTIC_TARGET_CONFIG_REQUIRED',
    };
    try {
      const resolved = await this.#resolveBoundView(binding);
      const frame = await this.#captureSemanticFrame(resolved.view.webContents);
      const exactUrl = canonical(frame?.url) === canonical(binding.conversation_url);
      const composer = exactTarget(frame, this.#composerRole, this.#composerName);
      const send = exactTarget(frame, this.#sendRole, this.#sendName);
      const generating = (frame?.semantic_targets || []).some((row) => row.role === 'button' && this.#stopNames.has(row.name));
      const incarnationMatches = !binding.target_incarnation || binding.target_incarnation === resolved.target_incarnation;
      return {
        ok: exactUrl && incarnationMatches && !generating && composer.length === 1 && send.length === 1,
        idle: !generating,
        composer_ready: composer.length === 1,
        unique_composer: composer.length === 1,
        unique_send_control: send.length === 1,
        exact_conversation: exactUrl,
        target_incarnation: resolved.target_incarnation,
        tab_id: resolved.tab.tab_id,
        authority: 'TRUSTED_NATIVE_SEMANTIC_PROBE',
        page_data_authority: false,
        reason: exactUrl ? null : 'BOUND_CONVERSATION_MISMATCH',
      };
    } catch (error) {
      return {
        ok: false,
        idle: false,
        composer_ready: false,
        unique_composer: false,
        unique_send_control: false,
        authority: 'TRUSTED_NATIVE_SEMANTIC_PROBE',
        reason: String(error?.message || error).slice(0, 200),
      };
    }
  }

  async semanticSend({ binding, message, wake_id, cycle_id, reason } = {}) {
    const resolved = await this.#resolveBoundView(binding);
    if (binding.target_incarnation && binding.target_incarnation !== resolved.target_incarnation) {
      return { outcome: 'NO_EFFECT', reason: 'TARGET_INCARNATION_STALE' };
    }
    const commandBase = { platform: 'CHATGPT', source: 'SUPERVISOR_KEEPALIVE_V1' };
    try {
      await this.#executeSemanticCommand(resolved.view.webContents, {
        ...commandBase,
        action: 'SEMANTIC_TYPE',
        payload: {
          role: this.#composerRole,
          accessible_name: this.#composerName,
          text: String(message),
          replace_existing: true,
        },
      });
    } catch (error) {
      return { outcome: 'NO_EFFECT', reason: `TYPE_NOT_ACTUATED:${String(error?.message || error).slice(0, 160)}` };
    }

    try {
      await this.#executeSemanticCommand(resolved.view.webContents, {
        ...commandBase,
        action: 'TYPED_CLICK',
        payload: { role: this.#sendRole, accessible_name: this.#sendName },
      });
    } catch (error) {
      return {
        outcome: definitePreActuationError(error) ? 'NO_EFFECT' : 'AMBIGUOUS',
        reason: `SEND_ERROR:${String(error?.message || error).slice(0, 160)}`,
      };
    }

    const exactNeedle = `METAENGINE_SUPERVISOR_WAKE_V1 cycle_id=${cycle_id} wake_id=${wake_id} reason=${reason}.`;
    for (const delay of this.#readbackDelaysMs) {
      if (delay) await sleep(delay);
      try {
        const frame = await this.#captureSemanticFrame(resolved.view.webContents);
        const stopVisible = (frame?.semantic_targets || []).some((row) => row.role === 'button' && this.#stopNames.has(row.name));
        const localEnvelopeReadback = String(frame?.text_excerpt || '').includes(exactNeedle);
        if (stopVisible || localEnvelopeReadback) {
          return {
            outcome: 'CONFIRMED',
            proof: stopVisible ? 'GENERATION_STARTED' : 'LOCAL_WAKE_ENVELOPE_READBACK',
            page_data_authority: false,
          };
        }
      } catch {}
    }
    return { outcome: 'AMBIGUOUS', reason: 'SEND_READBACK_NOT_PROVEN' };
  }
}

export { DEFAULT_STOP_NAMES };
