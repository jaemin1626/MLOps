'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('../utils/atomic-json-file');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CONNECTION_FILE = path.join(PROJECT_ROOT, 'config', 'mlops-connection.json');

let cachedConnection = null;

function resolveConnectionFile() {
  const configured = String(process.env.MLOPS_CONNECTION_FILE || '').trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(PROJECT_ROOT, configured);
  }
  return DEFAULT_CONNECTION_FILE;
}

function pickString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function buildApiBaseUrl(trainingServer = {}, fallbackPort = 9010) {
  const explicit = pickString(trainingServer.apiBaseUrl || trainingServer.baseUrl);
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const host = pickString(trainingServer.host);
  const port = Number(trainingServer.agentPort || fallbackPort);
  if (!host) {
    return '';
  }
  return `http://${host}:${port}`;
}

function loadConnectionConfig(options = {}) {
  if (cachedConnection && !options.reload) {
    return cachedConnection;
  }

  const connectionFile = resolveConnectionFile();
  if (!fs.existsSync(connectionFile)) {
    throw new Error(
      `연결 설정 파일이 없습니다: ${connectionFile}\n`
      + 'config/mlops-connection.example.json 을 복사해 config/mlops-connection.json 을 만드세요.',
    );
  }

  const raw = readJsonFile(connectionFile, {});
  const mlopsHost = raw.mlopsHost || {};
  const trainingServer = raw.trainingServer || {};
  const vlmTrainingServer = raw.vlmTrainingServer || {};
  const ssh = raw.ssh || {};
  const sharedHost = pickString(trainingServer.host, pickString(ssh.host));
  const mlopsPort = Number(mlopsHost.port || process.env.MLOPS_HOST_PORT || 18088);
  const apiBaseUrl = buildApiBaseUrl(trainingServer, 9010);
  const vlmApiBaseUrl = buildApiBaseUrl({
    host: pickString(vlmTrainingServer.host, sharedHost),
    agentPort: vlmTrainingServer.agentPort,
    apiBaseUrl: vlmTrainingServer.apiBaseUrl,
  }, 9011);
  const remoteWorkspaceRoot = pickString(
    ssh.remoteWorkspaceRoot || process.env.MLOPS_SSH_REMOTE_WORKSPACE_ROOT,
    '/home/ailab2/Workspace/MLops_test',
  ).replace(/\/+$/, '');

  cachedConnection = {
    connectionFile,
    mlopsHost: {
      port: mlopsPort,
      gpuDevice: pickString(mlopsHost.gpuDevice || process.env.MLOPS_GPU_DEVICE),
      publicBaseUrl: pickString(
        mlopsHost.publicBaseUrl || process.env.MLOPS_PUBLIC_BASE_URL,
        `http://127.0.0.1:${mlopsPort}`,
      ).replace(/\/$/, ''),
      dataRoot: pickString(mlopsHost.dataRoot || process.env.MLOPS_DATA_ROOT, './cache/ailab2-dataset'),
      workspacePath: pickString(mlopsHost.workspacePath || process.env.MLOPS_WORKSPACE_PATH, './workspace'),
      syncOnStart: mlopsHost.syncOnStart !== false && process.env.MLOPS_SYNC_ON_START !== '0',
      timezone: pickString(mlopsHost.timezone || process.env.TZ, 'Asia/Seoul'),
    },
    trainingServer: {
      host: sharedHost,
      agentPort: Number(trainingServer.agentPort || 9010),
      apiBaseUrl,
      authToken: pickString(trainingServer.authToken || process.env.MLOPS_TRAINING_SERVER_TOKEN),
      requestTimeoutMs: Number(trainingServer.requestTimeoutMs || 30000),
      workspaceRoot: pickString(
        trainingServer.workspaceRoot || process.env.TRAINING_WORKSPACE_ROOT,
        '/workspace',
      ).replace(/\/+$/, ''),
    },
    vlmTrainingServer: {
      host: pickString(vlmTrainingServer.host, sharedHost),
      agentPort: Number(vlmTrainingServer.agentPort || 9011),
      apiBaseUrl: vlmApiBaseUrl,
      authToken: pickString(
        vlmTrainingServer.authToken
        || trainingServer.authToken
        || process.env.MLOPS_VLM_TRAINING_SERVER_TOKEN
        || process.env.MLOPS_TRAINING_SERVER_TOKEN,
      ),
      requestTimeoutMs: Number(vlmTrainingServer.requestTimeoutMs || trainingServer.requestTimeoutMs || 30000),
      workspaceRoot: pickString(
        vlmTrainingServer.workspaceRoot
        || trainingServer.workspaceRoot
        || process.env.TRAINING_WORKSPACE_ROOT,
        '/workspace',
      ).replace(/\/+$/, ''),
    },
    ssh: {
      host: pickString(ssh.host, pickString(trainingServer.host)),
      user: pickString(ssh.user || process.env.MLOPS_SSH_USER, 'ailab2'),
      password: pickString(ssh.password || process.env.MLOPS_SSH_PASSWORD),
      remoteWorkspaceRoot,
      remoteDatasetPath: pickString(
        ssh.remoteDatasetPath || process.env.MLOPS_SSH_REMOTE_PATH,
        `${remoteWorkspaceRoot}/dataset`,
      ).replace(/\/+$/, ''),
    },
  };

  return cachedConnection;
}

function applyConnectionEnvironment(options = {}) {
  const connection = loadConnectionConfig(options);
  process.env.MLOPS_CONNECTION_FILE = connection.connectionFile;
  process.env.MLOPS_HOST_PORT = String(connection.mlopsHost.port);
  if (connection.mlopsHost.gpuDevice) {
    process.env.MLOPS_GPU_DEVICE = connection.mlopsHost.gpuDevice;
  }
  if (connection.mlopsHost.publicBaseUrl) {
    process.env.MLOPS_PUBLIC_BASE_URL = connection.mlopsHost.publicBaseUrl;
  }
  process.env.MLOPS_DATA_ROOT = connection.mlopsHost.dataRoot;
  process.env.MLOPS_WORKSPACE_PATH = connection.mlopsHost.workspacePath;
  process.env.MLOPS_SYNC_ON_START = connection.mlopsHost.syncOnStart ? '1' : '0';
  process.env.TZ = connection.mlopsHost.timezone;
  process.env.TRAINING_WORKSPACE_ROOT = connection.trainingServer.workspaceRoot;
  process.env.MLOPS_SSH_HOST = connection.ssh.host;
  process.env.MLOPS_SSH_USER = connection.ssh.user;
  process.env.MLOPS_SSH_PASSWORD = connection.ssh.password;
  process.env.MLOPS_SSH_REMOTE_WORKSPACE_ROOT = connection.ssh.remoteWorkspaceRoot;
  process.env.MLOPS_SSH_REMOTE_PATH = connection.ssh.remoteDatasetPath;
  if (connection.trainingServer.authToken) {
    process.env.MLOPS_TRAINING_SERVER_TOKEN = connection.trainingServer.authToken;
  }
  return connection;
}

module.exports = {
  DEFAULT_CONNECTION_FILE,
  applyConnectionEnvironment,
  buildApiBaseUrl,
  loadConnectionConfig,
  resolveConnectionFile,
};
