'use strict';

const path = require('path');

function getTrainingWorkspaceRoot(runtimeConfig) {
  const fromEnv = String(process.env.TRAINING_WORKSPACE_ROOT || '').trim();
  if (fromEnv) {
    return fromEnv.replace(/\\/g, '/').replace(/\/+$/, '');
  }
  return String(
    runtimeConfig?.training?.workspaceRoot
    || '/workspace',
  ).trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function assertRelativeTrainingPath(inputPath, fieldName) {
  const trimmed = String(inputPath ?? '').trim();
  if (!trimmed) {
    throw new Error(`${fieldName} 항목은 필수입니다.`);
  }
  if (path.posix.isAbsolute(trimmed) || /^[A-Za-z]:\//.test(trimmed)) {
    throw new Error(`${fieldName} 항목은 workspace 기준 상대 경로만 입력할 수 있습니다.`);
  }
  if (trimmed.split('/').some((segment) => segment === '..')) {
    throw new Error(`${fieldName} 항목에 .. 은 사용할 수 없습니다.`);
  }
  return trimmed.replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveTrainingServerPath(inputPath, workspaceRoot, fieldName) {
  const relativePath = assertRelativeTrainingPath(inputPath, fieldName);
  return path.posix.join(workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, ''), relativePath);
}

function toRelativeTrainingPath(inputPath, workspaceRoot) {
  const trimmed = String(inputPath ?? '').trim().replace(/\\/g, '/');
  if (!trimmed) {
    return '';
  }
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (path.posix.isAbsolute(trimmed)) {
    if (trimmed === normalizedRoot || trimmed.startsWith(`${normalizedRoot}/`)) {
      return trimmed.slice(normalizedRoot.length).replace(/^\/+/, '');
    }
    return trimmed;
  }
  return trimmed.replace(/^\/+/, '');
}

module.exports = {
  getTrainingWorkspaceRoot,
  assertRelativeTrainingPath,
  resolveTrainingServerPath,
  toRelativeTrainingPath,
};
