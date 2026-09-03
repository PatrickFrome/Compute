export const AGENTIC_TOOL_MANIFEST_SCHEMA = 'metaengine.browser.agentic-tool-manifest.v1';
export const AGENTIC_TOOL_MANIFEST_VERSION = '1.0.0';

export function createAgenticToolManifest() {
  const tools = Object.freeze([
    Object.freeze({ name: 'browser.snapshot', scope: 'READ_ONLY', trusted_shell_only: true, effect: false }),
    Object.freeze({ name: 'context.capture', scope: 'READ_ONLY_EXPLICIT_TABS', trusted_shell_only: true, effect: false }),
    Object.freeze({ name: 'shortcuts.list', scope: 'READ_ONLY', trusted_shell_only: true, effect: false }),
    Object.freeze({ name: 'shortcuts.prepare', scope: 'LOCAL_PROMPT_PREPARATION', trusted_shell_only: true, effect: false, auto_execute: false }),
    Object.freeze({ name: 'takeover.status', scope: 'READ_ONLY', trusted_shell_only: true, effect: false }),
    Object.freeze({ name: 'takeover.pause', scope: 'CONTROL_PLANE', trusted_shell_only: true, effect: true, retroactive_effect_cancellation: false }),
    Object.freeze({ name: 'takeover.resume', scope: 'CONTROL_PLANE', trusted_shell_only: true, effect: true, active_command_fence: true }),
  ]);
  return Object.freeze({
    schema: AGENTIC_TOOL_MANIFEST_SCHEMA,
    version: AGENTIC_TOOL_MANIFEST_VERSION,
    tools,
    external_network_listener: false,
    mcp_transport_exposed: false,
    cli_transport_exposed: false,
    webmcp_page_authority: false,
    os_shell_exposed: false,
    arbitrary_eval_exposed: false,
    physical_mutation_tools_exported: false,
    page_content_instruction_authority: false,
    automatic_effect_retry: false,
    second_scheduler: false,
    authority_effect: false,
  });
}
