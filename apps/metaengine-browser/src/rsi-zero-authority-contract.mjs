export const RSI_ZERO_AUTHORITY_SCHEMA='metaengine.rsi.zero-authority.v1';

export const RSI_ZERO_AUTHORITY_FIELDS=Object.freeze([
  'execution_authority',
  'browser_authority',
  'task_authority',
  'production_mutation_authority',
  'promotion_authority',
  'self_update_authority',
  'scheduler_authority',
  'authority_effect',
]);

export const RSI_ZERO_AUTHORITY_OPTIONAL_FIELDS=Object.freeze([
  'signing_authority',
  'direct_tool_execution_authority',
]);

export function assertRsiZeroAuthority(value,{error_prefix='rsi_zero_authority'}={}){
  if(!value||typeof value!=='object')throw new Error(`${error_prefix}_object_invalid`);
  for(const field of RSI_ZERO_AUTHORITY_FIELDS){
    if(value[field]!==false)throw new Error(`${error_prefix}_${field}_invalid`);
  }
  if(value.automatic_retry_allowed!==false)throw new Error(`${error_prefix}_retry_invalid`);
  for(const field of RSI_ZERO_AUTHORITY_OPTIONAL_FIELDS){
    if(Object.prototype.hasOwnProperty.call(value,field)&&value[field]!==false){
      throw new Error(`${error_prefix}_${field}_invalid`);
    }
  }
  return value;
}

export function rsiZeroAuthorityVector(){
  return Object.freeze({
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}

export function rsiZeroAuthorityTrustRootSnapshot(){
  return Object.freeze({
    schema:'metaengine.rsi.zero-authority-root.v1',
    version:1,
    contract_schema:RSI_ZERO_AUTHORITY_SCHEMA,
    required_false_fields:RSI_ZERO_AUTHORITY_FIELDS,
    automatic_retry_allowed:false,
    optional_authority_fields_if_present_must_be_false:RSI_ZERO_AUTHORITY_OPTIONAL_FIELDS,
    browser_authority_must_be_explicit:false,
    task_authority_must_be_explicit:false,
    implicit_missing_authority_is_not_zero:true,
  });
}
