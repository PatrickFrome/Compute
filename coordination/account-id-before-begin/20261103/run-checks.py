from pathlib import Path
import concurrent.futures, glob, json, subprocess, time

root=Path('/workspace/metaengine-account-source/Compute')
out=Path('/workspace/metaengine-results/account-id')
checks=[
 ('initial_setup', ['node','--test',*sorted(str(Path(p).relative_to(root)) for p in glob.glob(str(root/'apps/metaengine-browser/test/native-coding-initial-*.test.mjs')))], root),
 ('original_main_launch_source',['python3','apps/metaengine-browser/test/native/verify-guardian-original-main-launch-source.py'],root),
 ('begin_model',['python3','apps/metaengine-browser/test/native/verify-guardian-main-begin-model.py'],root),
 ('begin_model_sanitize',['python3','apps/metaengine-browser/test/native/verify-guardian-main-begin-model.py','--sanitize'],root),
 ('owner_wait_model',['python3','apps/metaengine-browser/test/native/verify-guardian-main-owner-wait-model.py'],root),
 ('owner_wait_model_sanitize',['python3','apps/metaengine-browser/test/native/verify-guardian-main-owner-wait-model.py','--sanitize'],root),
 ('requester_session_model',['python3','apps/metaengine-browser/test/native/verify-guardian-requester-session-model.py'],root),
 ('requester_session_model_sanitize',['python3','apps/metaengine-browser/test/native/verify-guardian-requester-session-model.py','--sanitize'],root),
 ('protocol_owner_ticket',['node','--test','apps/metaengine-browser/test/browser-guardian-original-main-launch-protocol.test.mjs','apps/metaengine-browser/test/guardian-owner-loaded-read.test.mjs','apps/metaengine-browser/test/browser-guardian-native-ticket-enrollment-contract.test.mjs'],root),
 ('check_source',['node','scripts/check-source.mjs'],root/'apps/metaengine-browser'),
 ('original_main_source',['python3','apps/metaengine-browser/test/native/verify-guardian-original-main-source.py','--repo',str(root),'--out',str(out/'source-evidence')],root),
 ('diff_check',['git','diff','--check'],root),
]
def run(item):
 name,cmd,cwd=item
 started=time.monotonic()
 try:
  p=subprocess.run(cmd,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=240)
  result={'name':name,'command':cmd,'cwd':str(cwd),'exit_code':p.returncode,'seconds':round(time.monotonic()-started,3),'log':name+'.log'}
  (out/result['log']).write_text(p.stdout)
 except Exception as e:
  result={'name':name,'command':cmd,'error':str(e),'seconds':round(time.monotonic()-started,3)}
 print(json.dumps(result),flush=True)
 return result
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
 results=list(executor.map(run,checks))
(out/'checks.json').write_text(json.dumps(results,indent=2)+'\n')
