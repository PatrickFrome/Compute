import type {ProjectHistoryEntry} from './client-project-history';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const AGENT=/^agent_[a-z0-9-]{8,64}$/;
const plain=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export type ProjectMessagePresentation=Readonly<{text:string;recipientTaskId:string;recipientAgentId:string;acknowledgement:'OBSERVED'|'NOT_OBSERVED_IN_WINDOW';acknowledgementSeq:number|null;processingVerified:false}>;
// Presentation only: absence from a filtered window never proves unread status.
export function projectMessagePresentation(entry:ProjectHistoryEntry,window:readonly ProjectHistoryEntry[]):ProjectMessagePresentation|null{
 const sources:Record<string,string>={BROWSER_AGENT_MESSAGE:'UNTRUSTED_BROWSER_AGENT_MESSAGE',NATIVE_AGENT_MESSAGE:'UNTRUSTED_NATIVE_AGENT_MESSAGE'};
 if(!Object.hasOwn(sources,entry.event_type)||entry.source!==sources[entry.event_type]||!UUID.test(entry.project_id)||!Number.isSafeInteger(entry.seq)||entry.seq<1||!plain(entry.content))return null;
 const body=entry.content;
 if(typeof body.message!=='string'||!body.message.trim()||new TextEncoder().encode(body.message).length>8192||typeof body.recipient_task_id!=='string'||!UUID.test(body.recipient_task_id)||typeof body.target_agent_id!=='string'||!AGENT.test(body.target_agent_id))return null;
 const ack=window.find(row=>row.project_id===entry.project_id&&Number.isSafeInteger(row.seq)&&row.seq>entry.seq
  &&row.event_type==='PROJECT_MESSAGE_ACKNOWLEDGED'&&row.source==='AUTHENTICATED_RECIPIENT_ACK'
  &&row.task_id===body.recipient_task_id&&row.actor===body.target_agent_id&&row.causal_parent_seq===entry.seq
  &&plain(row.content)&&row.content.message_seq===entry.seq&&row.content.recipient_task_id===body.recipient_task_id
  &&row.content.recipient_agent_id===body.target_agent_id&&row.content.recipient_acknowledged===true&&row.content.processing_verified===false);
 return Object.freeze({text:body.message,recipientTaskId:body.recipient_task_id,recipientAgentId:body.target_agent_id,
  acknowledgement:ack?'OBSERVED':'NOT_OBSERVED_IN_WINDOW',acknowledgementSeq:ack?.seq??null,processingVerified:false});
}
