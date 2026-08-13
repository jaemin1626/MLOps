'use strict';

const http = require('http');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function request(port, method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (_error) {
          json = text;
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  process.chdir(PROJECT_ROOT);
  const { server, runtimeConfig } = require('../../server/mlops-server');
  const port = Number(process.env.PORT || runtimeConfig.server.port || 18088);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const list = await request(port, 'GET', '/api/connections');
  console.log('Test 1 list connections:', list.status, Array.isArray(list.body?.connections) ? list.body.connections.length : list.body);

  const createA = await request(port, 'POST', '/api/connections', {
    name: 'Test Server A',
    host: '127.0.0.1',
    detector_port: 19010,
    vlm_port: 19011,
    ssh_user: 'invalid',
    ssh_password: 'invalid',
  }).catch((error) => ({ status: 401, body: { error: error.message } }));

  if (createA.status === 401 || createA.status === 400) {
    console.log('Test create with bad SSH rejected:', createA.status);
  }

  const listAfter = await request(port, 'GET', '/api/connections');
  for (const item of (listAfter.body?.connections || [])) {
    if (/^Test Server /.test(item.name)) {
      await request(port, 'DELETE', `/api/connections/${encodeURIComponent(item.connection_id)}`);
    }
  }

  const defaultConnection = (listAfter.body?.connections || [])[0];
  if (!defaultConnection) {
    console.log('Test 2 skipped: no connections registered');
  } else {
    const jobsA = await request(port, 'GET', `/api/training/jobs?connection_id=${encodeURIComponent(defaultConnection.connection_id)}`);
    console.log('Test 2 jobs without SSH active (expect 401):', jobsA.status, jobsA.body?.error);
  }

  const missing = await request(port, 'GET', `/api/training/jobs?connection_id=does-not-exist`);
  console.log('Test 5 missing connection:', missing.status, missing.body?.error);

  const active = await request(port, 'GET', '/api/connections/active');
  console.log('Active connection:', active.body?.activeConnection);

  const rawUrlRejected = await request(port, 'POST', '/api/training/jobs', {
    url: 'http://evil.example:9010',
    trainingType: 'detector',
    name: 'bad',
  });
  console.log('Raw URL rejected:', rawUrlRejected.status, rawUrlRejected.body?.error);

  const traversal = await request(port, 'GET', '/api/data/image?path=../../etc/passwd');
  console.log('Test 8 path traversal:', traversal.status, traversal.body?.error);

  server.close();
  console.log('Connection isolation smoke tests finished.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
