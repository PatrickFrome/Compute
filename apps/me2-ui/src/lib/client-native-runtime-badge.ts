type Badge=Readonly<{state:'UNAVAILABLE'|'UNBOUND'|'OBSERVED';label:string;detail:string;attention:boolean}>;
const plain=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min=0):v is number=>Number.isSafeInteger(v)&&Number(v)>=min;
const unknown=():Badge=>({state:'UNAVAILABLE',label:'Native: unknown',detail:'No current native runtime observation. This does not prove that no worker exists.',attention:false});
export function projectNativeRuntimeBadge(connection:unknown,{live=true,now=Date.now()}={}):Badge{
 if(!live||!plain(connection)||connection.local_runtime_ready!==true||!plain(connection.native_runtime))return unknown();
 const value=connection.native_runtime,observed=typeof value.observed_at==='string'?Date.parse(value.observed_at):NaN;
 if(value.schema!=='metaengine.client.native-runtime-observation.v1'||value.authority_effect!==false
  ||value.readback_only!==true||value.physical_execution_proven!==false||value.useful_work_verified!==false||value.logical_agent_limit!==null
  ||!Number.isFinite(observed)||!integer(now)||observed>now+5000||now-observed>30000)return unknown();
 if(value.state==='UNBOUND'&&value.retained_records===null&&value.counts===null&&value.closed===null&&value.physical_slot_budget===null)
  return {state:'UNBOUND',label:'Native: not mounted',detail:'No native runtime is bound. This is not an OS process census or execution permission.',attention:false};
 if(value.state!=='OBSERVED'||typeof value.closed!=='boolean'||!integer(value.physical_slot_budget,1)||!integer(value.retained_records)
  ||value.retained_records>value.physical_slot_budget||!plain(value.counts))return unknown();
 const keys=['preparing','running','result_ready','readback_required','other'];
 if(Object.keys(value.counts).sort().join('|')!==[...keys].sort().join('|')||keys.some(key=>!integer((value.counts as Record<string,unknown>)[key])))return unknown();
 const counts=value.counts as Record<string,number>,sum=keys.reduce((n,key)=>n+counts[key],0);
 if(!integer(sum)||sum!==value.retained_records)return unknown();
 const detail=`Runtime records: ${value.retained_records}; slot budget: ${value.physical_slot_budget}. Preparing: ${counts.preparing}; running state: ${counts.running}; results awaiting acknowledgement: ${counts.result_ready}; readback required: ${counts.readback_required}; other states: ${counts.other}. Execution, child shutdown and results require separate verification.`;
 return {state:'OBSERVED',label:value.closed?'Native: admission closed':counts.readback_required?`Native: ${counts.readback_required} need readback`:`Native: ${value.retained_records} records`,detail,attention:counts.readback_required>0};
}
