import {classifyNativeSpaHydration,unknownHydration} from './native-spa-hydration-proof.mjs';
// No Runtime.evaluate, DOM text, Request URL, response body, Input, reload,
// WebContents selection, cookies, or navigation. Probe one already owned WC.
const SELECTORS=Object.freeze({
  busy:'[aria-busy="true"],[role="progressbar"]',
  composer:'[contenteditable="true"],textarea',
  turns:'[data-message-author-role="user"],[data-message-author-role="assistant"]'
});
const limited=async (promise,ms=1500)=>{
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('native_probe_deadline')),ms);
  })]);}finally{clearTimeout(timer);}
};
const readFlags=wc=>{
  const flag=k=>typeof wc[k]==='function'?wc[k]():null;
  return {is_loading:flag('isLoading'),
    main_frame_loading:flag('isLoadingMainFrame'),
    waiting_for_response:flag('isWaitingForResponse')};
};
const readIdentity=(wc,ctx)=>({
  process_epoch:ctx.process_epoch,tab_id:ctx.tab_id,
  webcontents_id:wc.id,target_id:'webcontents:'+wc.id,
  renderer_pid:typeof wc.getOSProcessId==='function'?wc.getOSProcessId():null,
  renderer_generation:ctx.rendererGeneration(),
  navigation_generation:ctx.navigationGeneration()
});
const sameIdentity=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
export async function collectNativeSpaHydration(ctx) {
  const wc=ctx?.webContents;
  if(!wc||typeof ctx?.isCurrent!=='function'||
     typeof ctx?.rendererGeneration!=='function'||
     typeof ctx?.navigationGeneration!=='function')
    return unknownHydration('NATIVE_TARGET_UNKNOWN');
  let events=0,subscriber=null,dbg=null;
  const net={sampled:false,overflow:false,
    requests:0,failed:0,blocked:0,http_4xx:0,http_5xx:0};
  try{
    if(wc.isDestroyed()||!ctx.isCurrent())
      return unknownHydration('TARGET_CHANGED_OR_UNBOUND');
    const url=wc.getURL(),beforeId=readIdentity(wc,ctx),before=readFlags(wc);
    const renderer_crashed=typeof wc.isCrashed==='function'?wc.isCrashed():null;
    // Unverifiable native process identity cannot be repaired by CDP or URL.
    if(!Number.isSafeInteger(beforeId.renderer_pid)||beforeId.renderer_pid<1||
       !Number.isSafeInteger(beforeId.navigation_generation)||
       !Number.isSafeInteger(beforeId.renderer_generation))
      return unknownHydration('NATIVE_PROCESS_IDENTITY_UNKNOWN');
    if(renderer_crashed!==false)return unknownHydration('RENDERER_STATUS_UNKNOWN');
    dbg=wc.debugger;
    if(!dbg||typeof dbg.sendCommand!=='function'||
       typeof dbg.on!=='function'||typeof dbg.removeListener!=='function')
      return unknownHydration('CDP_UNAVAILABLE');
    if(!dbg.isAttached())dbg.attach('1.3');
    // Requests and failure buckets are scoped to THIS debugger and the
    // observation window only. Ignore potentially sensitive event fields.
    subscriber=(_event,method,p)=>{
      if(typeof method!=='string'||!method.startsWith('Network.'))return;
      if(++events>128){net.overflow=true;return;}
      if(method==='Network.requestWillBeSent')net.requests++;
      if(method==='Network.loadingFailed'){
        net.failed++;
        if(p?.blockedReason!=null)net.blocked++;
      }
      if(method==='Network.responseReceived'){
        const status=p?.response?.status;
        if(Number.isSafeInteger(status)&&status>=400&&status<500)net.http_4xx++;
        if(Number.isSafeInteger(status)&&status>=500&&status<600)net.http_5xx++;
      }
    };
    dbg.on('message',subscriber);
    try{
      await limited(dbg.sendCommand('Network.enable',{maxTotalBufferSize:0}));
      net.sampled=true;
    }catch{/* Retain UNKNOWN network coverage; no invented zero traffic. */}
    await limited(dbg.sendCommand('DOM.enable'));
    const doc=await limited(dbg.sendCommand('DOM.getDocument',{depth:1,pierce:false}));
    const rootId=doc?.root?.nodeId;
    if(!Number.isSafeInteger(rootId)||rootId<1)
      return unknownHydration('DOM_DOCUMENT_UNVERIFIED');
    const counts={};
    for(const [k,selector] of Object.entries(SELECTORS)){
      const r=await limited(dbg.sendCommand('DOM.querySelectorAll',
        {nodeId:rootId,selector}));
      if(!Array.isArray(r?.nodeIds)||r.nodeIds.length>2048||
         r.nodeIds.some(id=>!Number.isSafeInteger(id)||id<1))
        return unknownHydration('DOM_QUERY_UNVERIFIED');
      counts[k]=r.nodeIds.length;
    }
    // Brief bounded in-process native event sample, no arbitrary remote delay.
    if(net.sampled)await new Promise(resolve=>setTimeout(resolve,350));
    const afterId=readIdentity(wc,ctx),after=readFlags(wc);
    const stable=!wc.isDestroyed()&&ctx.isCurrent()&&
      wc.getURL()===url&&sameIdentity(beforeId,afterId);
    return classifyNativeSpaHydration({target_stable:stable,url,identity:afterId,
      before,after,counts,network:net,
      renderer_crashed:typeof wc.isCrashed==='function'?wc.isCrashed():null,
      observed_at:new Date().toISOString()});
  }catch{return unknownHydration('CDP_READBACK_FAILED');}
  finally{
    if(subscriber&&dbg)try{dbg.removeListener('message',subscriber);}catch{}
  }
}
