'use strict';

const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const port = 18080;
const baseUrl = `http://127.0.0.1:${port}`;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer(maximumAttempts = 40) {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (_error) {
      // Server startup can take a moment after npm install.
    }
    await wait(150);
  }
  throw new Error('테스트 서버가 제한 시간 안에 시작되지 않았습니다.');
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

async function run() {
  const server = spawn(process.execPath, ['server/intellivix-mlops-server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MLOPS_RUNTIME_PROFILE: 'host',
      MLOPS_CONNECTION_FILE: path.join(projectRoot, 'config', 'mlops-connection.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

  try {
    await waitForServer();
    const health = await requestJson(`${baseUrl}/api/health`);
    if (health.status !== 'ok') throw new Error('Health 상태가 ok가 아닙니다.');

    const config = await requestJson(`${baseUrl}/api/client-config`);
    const dashboard = await requestJson(`${baseUrl}/api/dashboard`);
    if (!dashboard.cards || !Array.isArray(dashboard.recentJobs)) throw new Error('Dashboard 응답 구조가 올바르지 않습니다.');

    const tree = await requestJson(`${baseUrl}/api/data/tree`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: config.dataRoot }),
    });
    if (!tree.tree || tree.tree.type !== 'directory') throw new Error('데이터 폴더 Tree 응답이 올바르지 않습니다.');

    const models = await requestJson(`${baseUrl}/api/model-management/models`);
    if (!Array.isArray(models.models)) throw new Error('모델 목록 응답이 올바르지 않습니다.');

    console.log('PASS: Health, Dashboard, Data Tree, Model API');
  } finally {
    server.kill('SIGTERM');
    await wait(100);
    if (stderr.trim()) console.error(stderr.trim());
  }
}

run().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
