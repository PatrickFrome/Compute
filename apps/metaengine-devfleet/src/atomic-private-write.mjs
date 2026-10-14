import crypto from 'node:crypto';
import fs from 'node:fs/promises';

// A bounded, same-snapshot retry is safe for journal persistence.
// Never return success without successful atomic rename or exact destination
// readback after an ambiguous native rename error.
export async function atomicPrivateWrite(file,content,{io=fs,delay=ms=>new Promise(r=>setTimeout(r,ms)),
  uuid=()=>crypto.randomUUID(),maxAttempts=4}={}) {
 if(typeof file!=='string'||!file||typeof content!=='string'||
   !Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>8)
    throw Error('journal_write_contract_invalid');
 const tmp=file+'.tmp-'+uuid();
 let staged=false;
 try {
  await io.writeFile(tmp,content,{encoding:'utf8',mode:0o600,flag:'wx'});
  staged=true;
  for(let attempt=0;attempt<maxAttempts;attempt++) {
   try {await io.rename(tmp,file);return {state:'COMMITTED',attempts:attempt+1};}
   catch(error) {
    // An error can occur after the OS has committed the rename; never
    // blindly repeat when same bytes are already confirmed on disk.
    let actual=null;
    try{actual=await io.readFile(file,'utf8');}catch{}
    if(actual===content)return {state:'COMMITTED_BY_READBACK',attempts:attempt+1};
    if(!['EPERM','EACCES','EBUSY'].includes(error?.code)||
       attempt===maxAttempts-1)throw error;
    await delay(20*(attempt+1));
   }
  }
 } finally {
  // Remove only our own unique staging file. A persistent failure
  // propagates and the operator keeps its existing reconciliation fence.
  if(staged)await io.rm(tmp,{force:true}).catch(()=>{});
 }
}
