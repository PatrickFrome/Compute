import http from 'node:http';

const role = process.argv[2];
const port = Number(role === 'api' ? process.env.LOCAL_STATE_API_PORT : process.env.LOCAL_STATE_EDGE_PORT);
const server = http.createServer((request, response) => {
  if (role === 'api' && request.headers.apikey !== process.env.LOCAL_STATE_API_KEY) {
    response.writeHead(401).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    ok: true,
    instance_id: process.env.LAUNCHER_TEST_WRONG_INSTANCE === role ? 'another-runtime' : process.env.LOCAL_STATE_INSTANCE_ID,
    runtime_ready: process.env.LAUNCHER_TEST_UNATTESTED !== '1',
    capability_health: { state: process.env.LAUNCHER_TEST_UNATTESTED === '1' ? 'UNATTESTED' : 'ATTESTED' },
  }));
});
server.listen(port, '127.0.0.1');
process.once('SIGTERM', () => server.close(() => process.exit(0)));
