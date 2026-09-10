import crypto from 'node:crypto';

export const CONTROL_ACTION_MANIFEST_SCHEMA = 'metaengine.control-actions-manifest.v1';

const rows = [
  ['POLL','OBSERVE','READ_ONLY','SHELL','READ_ONLY',true,true,true],
  ['CAPTURE','OBSERVE','READ_ONLY','CDP_ACCESSIBILITY','READ_ONLY',true,true,true],
  ['CAPTURE_VIEW','OBSERVE','READ_ONLY','ELECTRON_CAPTURE','READ_ONLY',true,true,true],
  ['CONTROL_CAPABILITIES','OBSERVE','READ_ONLY','CONTROL_PLANE','READ_ONLY',true,true,false],
  ['PROCESS_CENSUS','OBSERVE','READ_ONLY','ELECTRON_PROCESS_PLANE','READ_ONLY',true,true,false],
  ['PROCESS_EVENTS','OBSERVE','READ_ONLY','ELECTRON_PROCESS_PLANE','READ_ONLY',true,true,false],
  ['SEMANTIC_CENSUS','OBSERVE','READ_ONLY','PERSISTENT_CDP_SEMANTIC_PLANE','READ_ONLY',true,true,false],
  ['SEMANTIC_EVENTS','OBSERVE','READ_ONLY','PERSISTENT_CDP_SEMANTIC_PLANE','READ_ONLY',true,true,false],
  ['CONTROL_LATENCY_STATUS','OBSERVE','READ_ONLY','CONTROL_FAST_LANE','READ_ONLY',true,true,false],
  ['TAB_CENSUS','OBSERVE','READ_ONLY','SHELL_REGISTRY','READ_ONLY',true,false,false],
  ['FLEET_STATUS','FLEET','READ_ONLY','FLEET_PROVISIONER','READ_ONLY',true,false,false],
  ['DOWNLOAD_STATUS','DOWNLOADS','READ_ONLY','ELECTRON_SESSION','READ_ONLY',true,true,true],
  ['DEV_PLANE_STATUS','DEVELOPMENT','READ_ONLY','UTILITY_PROCESS','READ_ONLY',true,true,true],
  ['DEV_PLANE_HEALTH','DEVELOPMENT','READ_ONLY','UTILITY_PROCESS','READ_ONLY',true,true,true],
  ['DEV_PLANE_CAPABILITIES','DEVELOPMENT','READ_ONLY','UTILITY_PROCESS','READ_ONLY',true,true,true],
  ['DEV_PLANE_PROCESS_METRICS','DEVELOPMENT','READ_ONLY','UTILITY_PROCESS','READ_ONLY',true,true,true],
  ['DEV_PLANE_REPO_HEAD','DEVELOPMENT','READ_ONLY','UTILITY_PROCESS','READ_ONLY',true,true,true],
  ['SELF_UPDATE_STATUS','SELF_UPDATE','READ_ONLY','TRUSTED_UPDATER','READ_ONLY',true,true,true],
  ['GATE_STATUS','OWNER_AUTHORITY','READ_ONLY','OWNER_GATE_REGISTRY','READ_ONLY',true,true,false],

  ['STOP_GENERATION','PAGE_INPUT','MUTATING','CDP_SEMANTIC','TAB_MUTATION',true,true,true],
  ['SCROLL','PAGE_INPUT','MUTATING','CDP_INPUT','TAB_MUTATION',true,true,true],
  ['SEMANTIC_FOCUS','PAGE_INPUT','MUTATING','CDP_ACCESSIBILITY','TAB_MUTATION',true,true,true],
  ['SEMANTIC_TYPE','PAGE_INPUT','MUTATING','CDP_INPUT','TAB_MUTATION',true,true,true],
  ['TYPED_CLICK','PAGE_INPUT','MUTATING','CDP_INPUT','TAB_MUTATION',true,true,true],
  ['SELECT_TAB','TABS','MUTATING','SHELL_REGISTRY','TAB_MUTATION',true,true,true],
  ['CLOSE_TAB','TABS','MUTATING','ELECTRON_WEB_CONTENTS','TAB_MUTATION',true,true,true],
  ['NAVIGATE','NAVIGATION','MUTATING','ELECTRON_WEB_CONTENTS','TAB_MUTATION',true,true,true],
  ['BACK','NAVIGATION','MUTATING','ELECTRON_WEB_CONTENTS','TAB_MUTATION',true,true,true],
  ['FORWARD','NAVIGATION','MUTATING','ELECTRON_WEB_CONTENTS','TAB_MUTATION',true,true,true],
  ['RELOAD','NAVIGATION','MUTATING','ELECTRON_WEB_CONTENTS','TAB_MUTATION',true,true,true],

  ['ARM','AUTHORITY','MUTATING','NATIVE_SUPERVISOR','GLOBAL_MUTATION',true,true,true],
  ['DISARM','AUTHORITY','MUTATING','NATIVE_SUPERVISOR','EMERGENCY',true,true,true],
  ['SET_SUPERVISOR_MODE','AUTHORITY','MUTATING','NATIVE_SUPERVISOR','GLOBAL_MUTATION',true,true,true],
  ['SET_MODE','AUTHORITY','MUTATING','NATIVE_SUPERVISOR','GLOBAL_MUTATION',true,false,true],
  ['NEW_TAB','TABS','MUTATING','ELECTRON_WEB_CONTENTS','GLOBAL_MUTATION',true,true,true],
  ['FLEET_RECONCILE','FLEET','MUTATING','FLEET_PROVISIONER','GLOBAL_MUTATION',true,true,true],
  ['FLEET_SET_PROFILE','FLEET','MUTATING','FLEET_PROVISIONER','GLOBAL_MUTATION',true,true,true],
  ['DOWNLOAD_FILE','DOWNLOADS','MUTATING','VERIFIED_DOWNLOAD','GLOBAL_MUTATION',true,true,true],
  ['DOWNLOAD_CANCEL','DOWNLOADS','MUTATING','VERIFIED_DOWNLOAD','GLOBAL_MUTATION',true,true,true],
  ['SELF_UPDATE_CHECK','SELF_UPDATE','MUTATING','TRUSTED_UPDATER','GLOBAL_MUTATION',true,true,true],
  ['SELF_UPDATE_APPLY','SELF_UPDATE','MUTATING','TRUSTED_UPDATER','GLOBAL_MUTATION',true,true,true],
  ['GATE_DISABLE','OWNER_AUTHORITY','MUTATING','OWNER_GATE_REGISTRY','GLOBAL_MUTATION',true,true,false],
  ['GATE_DISABLE_ALL','OWNER_AUTHORITY','MUTATING','OWNER_GATE_REGISTRY','GLOBAL_MUTATION',true,true,false],
  ['GATE_ENABLE','OWNER_AUTHORITY','MUTATING','OWNER_GATE_REGISTRY','GLOBAL_MUTATION',true,true,false],
  ['GATE_ENABLE_ALL','OWNER_AUTHORITY','MUTATING','OWNER_GATE_REGISTRY','GLOBAL_MUTATION',true,true,false],

  // Present in the DB constraint/lane taxonomy but not implemented by the Browser dispatcher.
  ['RESOLVE_PROMPT','PAGE_INPUT','MUTATING','CDP_SEMANTIC','TAB_MUTATION',false,false,false],
];

export const CONTROL_ACTION_MANIFEST = Object.freeze(rows.map(([
  action, domain, effect, backend, lane, browser_implemented, public_capability, generic_issue_v1,
]) => Object.freeze({
  action,
  domain,
  effect,
  backend,
  lane,
  browser_implemented,
  public_capability,
  generic_issue_v1,
  deprecated: action === 'SET_MODE',
  automatic_retry_allowed: false,
  authority_effect: false,
})));

const canonical = JSON.stringify({
  schema: CONTROL_ACTION_MANIFEST_SCHEMA,
  actions: CONTROL_ACTION_MANIFEST.map(({ authority_effect, ...row }) => row),
});

export const CONTROL_ACTION_MANIFEST_REVISION = `sha256:${crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')}`;

export function controlActionDescriptor(action) {
  const key = String(action || '').trim().toUpperCase();
  return CONTROL_ACTION_MANIFEST.find((row) => row.action === key) || null;
}

export function browserImplementedControlActions() {
  return CONTROL_ACTION_MANIFEST.filter((row) => row.browser_implemented === true);
}

export function publicBrowserControlActions() {
  return CONTROL_ACTION_MANIFEST.filter((row) => row.browser_implemented === true && row.public_capability === true);
}

export function genericIssueV1ControlActions() {
  return CONTROL_ACTION_MANIFEST.filter((row) => row.generic_issue_v1 === true);
}
