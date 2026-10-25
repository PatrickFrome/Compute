export class NativeSupervisorBodyError extends Error {
  constructor(reason,status){super(reason);this.name='NativeSupervisorBodyError';this.status=status;}
}
const denied=(reason,status)=>new NativeSupervisorBodyError(reason,status);

// Authentication signs the exact body, so it necessarily follows this read.
// Bound its bytes, parallel streams and duration before JSON or crypto work.
// Health/OPTIONS do not enter this pool and remain available under load.
export function createNativeSupervisorBodyReader({maxBodyBytes=8*1024*1024,maxBufferedBytes=16*1024*1024,
  maxInflight=8,timeoutMs=12000}={}){
  if(![maxBodyBytes,maxBufferedBytes,maxInflight,timeoutMs].every(Number.isSafeInteger)
    ||maxBodyBytes<1||maxBodyBytes>8*1024*1024||maxBufferedBytes<maxBodyBytes||maxBufferedBytes>32*1024*1024
    ||maxInflight<1||maxInflight>16||timeoutMs<1||timeoutMs>15000)throw Error('native_supervisor_body_configuration_invalid');
  let inflight=0,buffered=0;
  return Object.freeze({
    async read(request){
      const length=request.headers.get('content-length');
      if(length!==null&&(!/^\d{1,16}$/.test(length)||Number(length)>maxBodyBytes))
        throw denied('request_body_too_large',413);
      if(!request.body)return '';
      if(inflight>=maxInflight)throw denied('request_body_busy',429);
      inflight++;let bytes=0,timer,expired=false,reader;
      const chunks=[];
      const stop=()=>{if(reader)void reader.cancel().catch(()=>{});};
      try{
        reader=request.body.getReader();
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;stop();reject(denied('request_body_timeout',408));},timeoutMs);});
        for(;;){
          const row=await Promise.race([reader.read(),timeout]);
          if(expired)throw denied('request_body_timeout',408);
          if(row.done)break;
          if(!(row.value instanceof Uint8Array))throw denied('request_body_invalid',400);
          if(chunks.length>=4096)throw denied('request_body_chunk_budget',413);
          if(bytes+row.value.length>maxBodyBytes)throw denied('request_body_too_large',413);
          if(buffered+row.value.length>maxBufferedBytes)throw denied('request_body_busy',429);
          // Copy once: a producer may reuse/change its own chunk after enqueue.
          chunks.push(row.value.slice());bytes+=row.value.length;buffered+=row.value.length;
        }
        const result=new Uint8Array(bytes);let offset=0;
        for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
        try{return new TextDecoder('utf-8',{fatal:true}).decode(result);}
        catch{throw denied('request_body_invalid_utf8',400);}
      }catch(error){
        stop();if(error instanceof NativeSupervisorBodyError)throw error;
        throw denied('request_body_unreadable',400);
      }finally{clearTimeout(timer);buffered-=bytes;inflight--;chunks.length=0;}
    },
    snapshot:()=>Object.freeze({inflight,buffered_bytes:buffered,max_body_bytes:maxBodyBytes,
      max_buffered_bytes:maxBufferedBytes,max_inflight:maxInflight}),
  });
}
