'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeWorkspaceRelativePath(relativePath) {
  const normalizedRelativePath = String(relativePath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedRelativePath || normalizedRelativePath.includes('..')) {
    return '';
  }
  return normalizedRelativePath;
}

function getRemoteWorkspaceAbsolutePath(relativePath) {
  const normalizedRelativePath = normalizeWorkspaceRelativePath(relativePath);
  if (!normalizedRelativePath) {
    return '';
  }
  const workspaceRoot = (process.env.MLOPS_SSH_REMOTE_WORKSPACE_ROOT || '/home/ailab2/Workspace/MLops_test')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  return `${workspaceRoot}/${normalizedRelativePath}`;
}

function statRemoteWorkspaceFile(relativePath, options = {}) {
  const normalizedRelativePath = normalizeWorkspaceRelativePath(relativePath);
  if (!normalizedRelativePath) {
    return 0;
  }

  const password = process.env.MLOPS_SSH_PASSWORD;
  if (!password) {
    return 0;
  }

  const host = process.env.MLOPS_SSH_HOST || '172.16.8.60';
  const user = process.env.MLOPS_SSH_USER || 'ailab2';
  const remotePath = getRemoteWorkspaceAbsolutePath(normalizedRelativePath);
  const timeoutMs = Number(options.timeoutMs || 15000);
  const remoteCommand = `if [ -f '${remotePath.replace(/'/g, `'\\''`)}' ]; then stat -c%s '${remotePath.replace(/'/g, `'\\''`)}'; else echo 0; fi`;

  const result = spawnSync('sshpass', [
    '-p', password,
    'ssh',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    `${user}@${host}`,
    remoteCommand,
  ], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      HOME: '/tmp',
      USER: 'mlops',
      LOGNAME: 'mlops',
    },
  });

  if (result.error || result.status !== 0) {
    return 0;
  }

  const size = Number(String(result.stdout || '').trim());
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function fetchRemoteWorkspaceFileViaSsh(dataRoot, relativePath, options = {}) {
  const normalizedRelativePath = normalizeWorkspaceRelativePath(relativePath);
  if (!normalizedRelativePath) {
    throw new Error('workspace 상대 경로가 올바르지 않습니다.');
  }

  const password = process.env.MLOPS_SSH_PASSWORD;
  if (!password) {
    throw new Error('MLOPS_SSH_PASSWORD가 설정되지 않았습니다.');
  }

  const host = process.env.MLOPS_SSH_HOST || '172.16.8.60';
  const user = process.env.MLOPS_SSH_USER || 'ailab2';
  const workspaceRoot = (process.env.MLOPS_SSH_REMOTE_WORKSPACE_ROOT || '/home/ailab2/Workspace/MLops_test')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  const remotePath = `${workspaceRoot}/${normalizedRelativePath}`;
  const timeoutMs = Number(options.timeoutMs || 180000);

  const cacheRoot = String(dataRoot || '/workspace/dataset').trim();
  const cacheDir = path.join(cacheRoot, '.mlops-onnx-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `onnx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.bin`);

  const remoteTarget = `${user}@${host}:${remotePath}`;
  const copyResult = spawnSync('sshpass', [
    '-p', password,
    'scp',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    remoteTarget,
    cacheFile,
  ], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      HOME: '/tmp',
      USER: 'mlops',
      LOGNAME: 'mlops',
    },
  });

  if (copyResult.error) {
    throw copyResult.error;
  }
  if (copyResult.status !== 0 || !fs.existsSync(cacheFile) || !fs.statSync(cacheFile).size) {
    const message = String(copyResult.stderr || copyResult.stdout || '').trim();
    if (/No such file or directory/i.test(message)) {
      throw new Error(`원격 파일을 찾을 수 없습니다: ${remotePath}`);
    }
    throw new Error(message || 'SSH로 ONNX 파일을 가져오지 못했습니다.');
  }

  return {
    filePath: cacheFile,
    sizeBytes: fs.statSync(cacheFile).size,
  };
}

function writeJsonAtomic(filePath, payload) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

async function fetchRemoteWorkspaceFileViaHostSync(dataRoot, relativePath, options = {}) {
  if (process.env.MLOPS_SSH_PASSWORD) {
    return fetchRemoteWorkspaceFileViaSsh(dataRoot, relativePath, options);
  }

  const normalizedRoot = String(dataRoot || '').trim();
  const normalizedRelativePath = String(relativePath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedRoot) {
    throw new Error('dataRoot가 설정되지 않았습니다.');
  }
  if (process.env.MLOPS_DATASET_SYNC_ENABLED === '0') {
    throw new Error('호스트 SSH 동기화가 비활성화되어 있습니다.');
  }

  const requestId = `onnx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const requestDir = path.join(normalizedRoot, '.mlops-onnx-fetch-requests');
  const cacheDir = path.join(normalizedRoot, '.mlops-onnx-cache');
  const cacheFile = path.join(cacheDir, `${requestId}.bin`);
  const requestPath = path.join(requestDir, `${requestId}.json`);
  const statusPath = path.join(requestDir, `${requestId}.status.json`);

  fs.mkdirSync(requestDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  writeJsonAtomic(requestPath, {
    requestId,
    relativePath: normalizedRelativePath,
    cacheFile,
    requestedAt: new Date().toISOString(),
  });

  const timeoutMs = Number(options.timeoutMs || 180000);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(statusPath)) {
      let status = {};
      try {
        status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      } catch (_error) {
        status = { state: 'error', message: 'fetch status JSON 파싱 실패' };
      }
      fs.rmSync(statusPath, { force: true });
      fs.rmSync(requestPath, { force: true });

      if (status.state === 'ok' && fs.existsSync(cacheFile) && fs.statSync(cacheFile).isFile()) {
        return {
          filePath: cacheFile,
          sizeBytes: fs.statSync(cacheFile).size,
        };
      }
      throw new Error(status.message || '원격 ONNX 파일 가져오기 실패');
    }
    await sleep(200);
  }

  fs.rmSync(requestPath, { force: true });
  throw new Error(`원격 ONNX 파일 가져오기 시간 초과 (${Math.round(timeoutMs / 1000)}s)`);
}

module.exports = {
  fetchRemoteWorkspaceFileViaHostSync,
  fetchRemoteWorkspaceFileViaSsh,
  statRemoteWorkspaceFile,
};
