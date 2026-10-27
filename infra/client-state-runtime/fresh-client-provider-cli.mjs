import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {provisionFreshClientProvider,FRESH_CLIENT_INSTALL_ACTION} from './fresh-client-provider.mjs';

export function parseFreshClientArguments(argv) {
  if(!Array.isArray(argv)||argv.length!==4||argv[0]!=='--bundle-sha256'||!/^[a-f0-9]{64}$/.test(argv[1]||'')
    ||argv[2]!=='--owner-action'||argv[3]!==FRESH_CLIENT_INSTALL_ACTION)throw Error('fresh_client_arguments_invalid');
  return {expectedBundleDigest:argv[1],ownerAction:argv[3]};
}
export async function runFreshClientProviderCli(argv) {
  const args=parseFreshClientArguments(argv);
  // Entry is fixed inside verified offline bundle/source/infra/client-state-runtime.
  // Neither arbitrary SQL paths nor endpoint/credential arguments exist.
  const bundleDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  return provisionFreshClientProvider({...args,bundleDirectory,
    localAppData:process.env.LOCALAPPDATA,appData:process.env.APPDATA});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await runFreshClientProviderCli(process.argv.slice(2))));}
  catch {console.error('fresh_client_setup_requires_review');process.exitCode=1;}
}
