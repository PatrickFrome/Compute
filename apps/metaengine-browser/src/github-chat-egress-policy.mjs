// Strict egress boundary for the owner-PC GitHub relay. Private GitHub
// issues are a transport, not a credential, PGDATA or log archive.
//
// Preserve bounded structured observation and signed receipt metadata while
// omitting any field that could contain local secrets, environment, arbitrary
// process output, screenshots' temporary paths, or connection strings.
const SENSITIVE_FIELD=/(?:^|[_-])(?:password|passwd|pwd|token|secret|credential|credentials|authorization|auth|argv|arguments|command_line|command_args|payload|clipboard|form_values|cookie|cookies|set_cookie|private|api_key|api_key_id|service_role|bearer|oauth|session_key|pgpassword|pgdata|postgres_url|database_url|db_url|connection_string|vault|ssh|pem|jwt|environment|env|query_parameters|raw_output|raw_response|page_text|headers|request_headers|response_headers|stdout|stderr|raw_config|private_config|local_path|png_path|file_path|full_path|data_directory|state_directory|home_directory|user_data|access_key|refresh_key)(?:$|[_-])/i;
const PATH_FIELD=/^(?:path|filepath|filename|directory|cwd|workdir|command_line|args|arguments|env_vars|variables)$/i;
const PRIVATE_TEXT=/(?:\b(?:Bearer|Basic)\s+[A-Za-z0-9._+\/=-]{6,}|github_pat_[a-zA-Z0-9_]{10,}|\bgh[pousr]_[a-zA-Z0-9]{10,}|(?:postgres(?:ql)?|file):\/\/\S+|https?:\/\/[^\s/@:]+:[^\s/@]+@|https?:\/\/[^\s]+[?&](?:token|api_key|access_token|secret|signature|sig|auth)=\S+|(?:[a-zA-Z]:\\|\\\\[^\s\\]+\\|\/(?:home|Users|root|var\/lib\/postgresql)\/)\S+|-----BEGIN (?:OPENSSH|RSA|EC|PRIVATE) KEY-----|\b(?:password|api[_ -]?key|client[_ -]?secret|access[_ -]?token)\s*[:=]\s*\S+)/i;
const MAX_BYTES=36_000, MAX_NODES=2500, MAX_DEPTH=14, MAX_FIELDS=100, MAX_ARRAY=256, MAX_STRING=1500;
// A safe reply is status and receipt *metadata*, not arbitrary text from
// a browser tab, filesystem, agent prompt, screenshot OCR or process output.
const SAFE_TEXT_FIELDS=/^(?:schema|state|status|provider|profile|source|action|effect|reason|code|error_code|command_id|request_id|goal_id|task_id|client_id|relay_id|instance_id|device_id|point_id|source_head|package_version|version|build_id|sha256|png_sha256|bundle_sha256|digest|repository|mime_type|reconcile_with)$/i;
const SAFE_ARRAY_TEXT_FIELDS=/^(?:actions|capabilities|scopes|permissions)$/i;
// JSON property names are data too. Accept reviewed metadata names only;
// private paths, tokens and page contents must not leave as object keys.
const SAFE_FIELD_NAMES=new Set((
  'result receipt artifact counts deep tabs agents events files self capabilities actions scopes permissions '+
  'message title url instructions objective browser_text userMessage '+
  'terminal ok available ready enabled connected active success supported accepted duplicate replayed found '+
  'authority_effect page_data_authority automatic_retry_allowed scheduler_authority '+
  'command_leasing command_leasing_authority browser_execution_authority execution_authority second_scheduler '+
  'bytes width height queued running completed failed pending total count agent_count command_count '+
  'task_count goal_count window_count display_count generation sequence revision elapsed_ms duration_ms '+
  'timestamp created_at updated_at expires_at started_at stopped_at '+
  'health runtime supervisor transport task_state_provider realtime_process_plane '+
  'control_protocol_revision scope required_scope outcome target_identity_sha256 '+
  'schema_version source_head_sha request_comment_id body_sha256 source_restore_receipt_sha256 '+
  'source_dump_sha256 attested_instance_id cleanup_confirmed runtime_ready owner_profile_written '+
  'existing_restored_database_selected source_restore_receipt_verified source_schema_exact '+
  'private_vault_key_preserved database_initialized installed_normal_boot_verified '+
  'password passwd pwd token secret credential credentials authorization auth argv arguments '+
  'command_line command_args payload clipboard form_values cookie cookies set_cookie private '+
  'api_key api_key_id service_role bearer oauth session_key pgpassword pgdata postgres_url '+
  'database_url db_url connection_string vault ssh pem jwt environment env query_parameters '+
  'raw_output raw_response page_text headers request_headers response_headers stdout stderr '+
  'raw_config private_config private_config_file local_path png_path file_path full_path '+
  'data_directory state_directory home_directory user_data access_key refresh_key'
).split(' '));
const safeFieldName=name=>name.length<=80&&!PRIVATE_TEXT.test(name)
  &&(SAFE_FIELD_NAMES.has(name)||SAFE_TEXT_FIELDS.test(name)||SAFE_ARRAY_TEXT_FIELDS.test(name)||PATH_FIELD.test(name));
const SAFE_TEXT_SHAPE=/^[A-Za-z0-9_:.\/ -]{1,180}$/;
const fixedBlocked=reason=>Object.freeze({schema:'metaengine.github-chat-safe-egress.v1',
  state:'RESULT_UNAVAILABLE',reason,automatic_retry_allowed:false,authority_effect:false});
const isPlain=value=>{
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return proto===Object.prototype||proto===null;
};
function safeText(text,key){
  // Keys from trusted structured APIs can still contain binary, API tokens,
  // absolute paths, credentials or arbitrary HTML/form values.
  if(text.length>MAX_STRING||PRIVATE_TEXT.test(text)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
    return '[PRIVATE_OR_UNBOUNDED_VALUE]';
  if(PATH_FIELD.test(key)&&(/^(?:\/|[a-zA-Z]:\\|\\\\)/.test(text)))return '[PRIVATE_PATH]';
  return text;
}
export function projectGithubChatReplyResult(result){
  let nodes=0;
  const seen=new WeakSet();
  function visit(value,key,depth,parent=''){
    nodes++;
    if(nodes>MAX_NODES||depth>MAX_DEPTH)throw new Error('egress_resource_limit');
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    if(typeof value==='string'){
      // A repository-artifact path is a stable public identifier within the
      // paired private repository; every other filename/path is local state.
      if(PATH_FIELD.test(key))
        return parent==='artifact'&&/^metaengine-chat-artifacts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.png$/.test(value)
          ?value:'[PRIVATE_PATH]';
      if(!SAFE_TEXT_FIELDS.test(key)&&!(SAFE_ARRAY_TEXT_FIELDS.test(key)&&parent===key))
        return '[REDACTED_UNREVIEWED_TEXT]';
      // Even explicitly allowlisted metadata cannot smuggle URL query
      // credentials, arbitrary paths or control characters into a reply.
      if(!SAFE_TEXT_SHAPE.test(value))return '[REDACTED_UNREVIEWED_TEXT]';
      return safeText(value,key);
    }
    if(Array.isArray(value)){
      if(seen.has(value)||value.length>MAX_ARRAY)throw new Error('egress_array_unsafe');
      seen.add(value);
      return value.map(item=>visit(item,key,depth+1,key));
    }
    if(!isPlain(value)||seen.has(value))throw new Error('egress_object_unsafe');
    seen.add(value);
    const keys=Object.keys(value);
    if(keys.length>MAX_FIELDS)throw new Error('egress_object_unbounded');
    const out={};
    for(const name of keys){
      if(['__proto__','constructor','prototype'].includes(name))continue;
      if(!safeFieldName(name)){
        // Omit the name entirely, while still enforcing graph/resource bounds
        // on its value. Replacing only the value would disclose the key.
        visit(value[name],'',depth+1,key);
        continue;
      }
      if(SENSITIVE_FIELD.test(name)){out[name]='[REDACTED]';continue;}
      out[name]=visit(value[name],name,depth+1,key);
    }
    return out;
  }
  try {
    const safe=visit(result,'result',0);
    const data=JSON.stringify(safe);
    if(!data||Buffer.byteLength(data,'utf8')>MAX_BYTES)return fixedBlocked('RESULT_TOO_LARGE');
    return safe;
  }catch{
    return fixedBlocked('UNSAFE_RESULT');
  }
}
