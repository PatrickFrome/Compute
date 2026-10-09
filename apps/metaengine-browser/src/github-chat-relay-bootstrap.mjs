import path from 'node:path';
import { createHash } from 'node:crypto';
import { GithubChatRelay, normalizeGithubChatPairing } from './github-chat-relay.mjs';
import { GithubChatRelayJournal, readPrivateRelayFile } from './github-chat-relay-journal.mjs';
import { readGithubChatCapture } from './github-chat-capture.mjs';

export const GITHUB_CHAT_PAIRING_FILE='github-chat-pairing-v1.json';
export const GITHUB_CHAT_TOKEN_FILE='github-chat-token-v1.bin';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pairingFromBytes=bytes=>{
  try{return normalizeGithubChatPairing(JSON.parse(bytes.toString('utf8')));}
  catch{throw new Error('github_chat_pairing_invalid');}
};

export async function revokeInstalledGithubChatPairing({userDataPath,clientId}={}) {
  let bytes;
  try{bytes=await readPrivateRelayFile(path.join(userDataPath,GITHUB_CHAT_PAIRING_FILE));}
  catch(error){if(error.code==='ENOENT')return {schema:'metaengine.github-chat-relay.v1',state:'NOT_PAIRED',authority_effect:false};throw error;}
  const pairing=pairingFromBytes(bytes);
  if(pairing.client_id!==clientId)throw new Error('github_chat_pairing_client_mismatch');
  const journal=await new GithubChatRelayJournal(path.join(userDataPath,'github-chat-delivery-journal')).initialize();
  await journal.revoke(pairing.relay_id);
  return {schema:'metaengine.github-chat-relay.v1',state:'REVOKED',repository:pairing.repository,
    issue_number:pairing.issue_number,relay_id:pairing.relay_id,authority_effect:false};
}

export async function startInstalledGithubChatRelay({userDataPath,clientId,localProvider,safeStorage,control,fetchImpl}={}) {
  const pairingFile=path.join(userDataPath,GITHUB_CHAT_PAIRING_FILE);
  let bytes;
  try{bytes=await readPrivateRelayFile(pairingFile);}
  catch(error){if(error.code==='ENOENT')return null;throw new Error('github_chat_pairing_file_unverified');}
  if(localProvider!==true)throw new Error('github_chat_local_postgres_required');
  const pairing=pairingFromBytes(bytes);
  if(pairing.client_id!==clientId)throw new Error('github_chat_pairing_client_mismatch');
  if(!safeStorage?.isEncryptionAvailable?.()||typeof safeStorage.decryptString!=='function')throw new Error('github_chat_secure_storage_required');
  if(safeStorage.getSelectedStorageBackend?.()==='basic_text')throw new Error('github_chat_secure_storage_required');
  const tokenFile=path.join(userDataPath,GITHUB_CHAT_TOKEN_FILE);
  const tokenBytes=await readPrivateRelayFile(tokenFile,4096);
  const pairingHash=sha(bytes),tokenHash=sha(tokenBytes);
  const journal=await new GithubChatRelayJournal(path.join(userDataPath,'github-chat-delivery-journal')).initialize();
  const relay=new GithubChatRelay({pairing,control,journal,readCapture:readGithubChatCapture,
    ...(fetchImpl?{fetchImpl}:{}),getToken:async()=>safeStorage.decryptString(await readPrivateRelayFile(tokenFile,4096)),
    isPairingCurrent:async()=>{
      try{return sha(await readPrivateRelayFile(pairingFile))===pairingHash
        &&sha(await readPrivateRelayFile(tokenFile,4096))===tokenHash;}
      catch{return false;}
    },
  });
  // Validate transport first; command delivery starts on the next tick, after
  // main.mjs owns this instance and can fence its admitted command executions.
  await relay.start({processInitial:false});
  return relay;
}
