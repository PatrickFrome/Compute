import http from 'node:http';
import { readFileSync } from 'node:fs';

const role = process.argv[2];
const port = Number(role === 'api' ? process.env.LOCAL_STATE_API_PORT : process.env.LOCAL_STATE_EDGE_PORT);
const server = http.createServer((request, response) => {
  if (role === 'api' && request.headers.apikey !== process.env.LOCAL_STATE_API_KEY) {
    response.writeHead(401).end();
    return;
  }
  let control = {};
  if (process.argv[3]) {
    try { control = JSON.parse(readFileSync(process.argv[3], 'utf8'))[role] || {}; } catch { /* Control belongs only to a temporary test fixture. */ }
  }
  const send = () => {
    response.writeHead(control.http_status || 200, { 'content-type': 'application/json' });
    response.end(control.invalid_json ? 'synthetic-private-invalid-response' : JSON.stringify({
      ok: control.not_ready !== true,
      instance_id: control.wrong_instance || process.env.LAUNCHER_TEST_WRONG_INSTANCE === role ? 'another-runtime' : process.env.LOCAL_STATE_INSTANCE_ID,
      runtime_ready: control.unattested !== true && process.env.LAUNCHER_TEST_UNATTESTED !== '1',
      capability_health: { state: control.unattested || process.env.LAUNCHER_TEST_UNATTESTED === '1' ? 'UNATTESTED' : 'ATTESTED' },
      private_fixture_payload: 'synthetic-private-response-must-not-escape',
    }));
  };
  if (control.delay_ms) setTimeout(send, control.delay_ms); else send();
});
server.listen(port, '127.0.0.1');
process.once('SIGTERM', () => server.close(() => process.exit(0)));
