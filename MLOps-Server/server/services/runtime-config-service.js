'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('../utils/atomic-json-file');
const { applyConnectionEnvironment, loadConnectionConfig } = require('./connection-config-service');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULTS_CONFIG_FILE = path.join(PROJECT_ROOT, 'config', 'mlops-runtime-defaults.json');

function resolveProjectPath(value, baseDir = PROJECT_ROOT) {
  if (!value) {
    return value;
  }
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(baseDir, value);
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return base;
  }
  const result = { ...base };
  Object.entries(override).forEach(([key, value]) => {
    if (key.startsWith('_')) {
      return;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)
      && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
      return;
    }
    if (value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

function detectRuntimeProfile() {
  const explicit = String(process.env.MLOPS_RUNTIME_PROFILE || '').trim().toLowerCase();
  if (explicit === 'docker' || explicit === 'host') {
    return explicit;
  }
  if (fs.existsSync('/app/workspace') && fs.existsSync('/workspace/dataset')) {
    return 'docker';
  }
  return 'host';
}

function buildProfileConfig(profile, connection) {
  if (profile === 'docker') {
    return {
      workspaceRoot: '/app/workspace',
      allowedDataRoots: ['/workspace/dataset'],
      paths: {
        dataRoot: '/workspace/dataset',
        jobRoot: '/app/workspace/jobs',
        modelRoot: '/app/workspace/models',
        exportRoot: '/app/workspace/exports',
        logRoot: '/app/workspace/logs',
      },
    };
  }

  const dataRoot = resolveProjectPath(connection.mlopsHost.dataRoot);
  const workspaceRoot = resolveProjectPath(connection.mlopsHost.workspacePath);
  return {
    workspaceRoot,
    allowedDataRoots: [dataRoot],
    paths: {
      dataRoot,
      jobRoot: path.join(workspaceRoot, 'jobs'),
      modelRoot: path.join(workspaceRoot, 'models'),
      exportRoot: path.join(workspaceRoot, 'exports'),
      logRoot: path.join(workspaceRoot, 'logs'),
    },
  };
}

function resolveOptionalOverrideFile() {
  const configuredPath = String(process.env.MLOPS_CONFIG_FILE || '').trim();
  if (!configuredPath) {
    return null;
  }
  const resolvedPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(PROJECT_ROOT, configuredPath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }
  return resolvedPath;
}

function normalizeExecutionMode(mode, fallback = 'local') {
  if (mode === 'agent') {
    return 'remote';
  }
  return mode || fallback;
}

function getRuntimeConfig() {
  const connection = applyConnectionEnvironment();
  const profile = detectRuntimeProfile();
  const defaults = readJsonFile(DEFAULTS_CONFIG_FILE, {});
  const profileConfig = buildProfileConfig(profile, connection);
  const overrideFile = resolveOptionalOverrideFile();
  const overrideConfig = overrideFile ? readJsonFile(overrideFile, {}) : {};
  const raw = deepMerge(deepMerge(defaults, profileConfig), overrideConfig);

  const trainingServerBaseUrl = String(
    connection.trainingServer.apiBaseUrl
    || raw.trainingServer?.baseUrl
    || raw.training?.agentBaseUrl
    || raw.export?.agentBaseUrl
    || '',
  ).trim();
  const vlmTrainingServerBaseUrl = String(
    connection.vlmTrainingServer.apiBaseUrl
    || raw.vlmTrainingServer?.baseUrl
    || raw.training?.vlmAgentBaseUrl
    || '',
  ).trim();

  const trainingServer = {
    baseUrl: trainingServerBaseUrl,
    requestTimeoutMs: Number(
      connection.trainingServer.requestTimeoutMs
      || raw.trainingServer?.requestTimeoutMs
      || raw.training?.requestTimeoutMs
      || raw.export?.requestTimeoutMs
      || 10000,
    ),
    mlopsPublicBaseUrl: String(
      connection.mlopsHost.publicBaseUrl
      || raw.trainingServer?.mlopsPublicBaseUrl
      || process.env.MLOPS_PUBLIC_BASE_URL
      || '',
    ).trim(),
    authToken: String(
      connection.trainingServer.authToken
      || raw.trainingServer?.authToken
      || process.env.MLOPS_TRAINING_SERVER_TOKEN
      || '',
    ).trim(),
  };

  const vlmTrainingServer = {
    baseUrl: vlmTrainingServerBaseUrl,
    requestTimeoutMs: Number(
      connection.vlmTrainingServer.requestTimeoutMs
      || raw.vlmTrainingServer?.requestTimeoutMs
      || trainingServer.requestTimeoutMs
      || 10000,
    ),
    mlopsPublicBaseUrl: trainingServer.mlopsPublicBaseUrl,
    authToken: String(
      connection.vlmTrainingServer.authToken
      || trainingServer.authToken
      || process.env.MLOPS_VLM_TRAINING_SERVER_TOKEN
      || process.env.MLOPS_TRAINING_SERVER_TOKEN
      || '',
    ).trim(),
  };

  return {
    ...raw,
    runtimeProfile: profile,
    projectRoot: PROJECT_ROOT,
    configFile: overrideFile || DEFAULTS_CONFIG_FILE,
    connectionFile: connection.connectionFile,
    connection,
    workspaceRoot: raw.workspaceRoot,
    allowedDataRoots: raw.allowedDataRoots?.length
      ? raw.allowedDataRoots
      : [connection.ssh.remoteDatasetPath],
    paths: raw.paths,
    trainingServer,
    vlmTrainingServer,
    data: {
      ...(raw.data || {}),
      executionMode: normalizeExecutionMode(raw.data?.executionMode, 'local'),
    },
    models: {
      ...(raw.models || {}),
      executionMode: normalizeExecutionMode(raw.models?.executionMode, 'local'),
    },
    training: {
      ...(raw.training || {}),
      executionMode: normalizeExecutionMode(raw.training?.executionMode, 'simulator'),
      agentBaseUrl: raw.training?.agentBaseUrl || trainingServer.baseUrl,
      vlmAgentBaseUrl: raw.training?.vlmAgentBaseUrl || vlmTrainingServer.baseUrl,
      workspaceRoot: connection.trainingServer.workspaceRoot,
    },
    export: {
      ...(raw.export || {}),
      executionMode: normalizeExecutionMode(raw.export?.executionMode, 'simulator'),
      agentBaseUrl: raw.export?.agentBaseUrl || trainingServer.baseUrl,
    },
  };
}

function resolveConfigFile() {
  return resolveOptionalOverrideFile() || DEFAULTS_CONFIG_FILE;
}

module.exports = {
  getRuntimeConfig,
  resolveConfigFile,
  detectRuntimeProfile,
};
