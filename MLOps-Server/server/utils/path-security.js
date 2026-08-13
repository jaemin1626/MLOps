'use strict';

const fs = require('fs');
const path = require('path');

function createClientError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeAbsolutePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw createClientError('경로가 비어 있습니다.');
  }
  return path.resolve(inputPath.trim());
}

function isPathInside(candidatePath, rootPath) {
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensureAllowedPath(candidatePath, allowedRoots, options = {}) {
  const normalized = normalizeAbsolutePath(candidatePath);
  const roots = allowedRoots.map((root) => path.resolve(root));
  if (!roots.some((root) => isPathInside(normalized, root))) {
    throw createClientError(`허용되지 않은 경로입니다: ${normalized}`);
  }
  if (options.mustExist !== false && !fs.existsSync(normalized)) {
    throw createClientError(`경로가 존재하지 않습니다: ${normalized}`);
  }
  return normalized;
}

function sanitizeFileName(fileName, extension = '') {
  const raw = String(fileName || '').trim();
  const withoutExtension = extension && raw.toLowerCase().endsWith(extension.toLowerCase())
    ? raw.slice(0, -extension.length)
    : raw;
  const safe = withoutExtension.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  if (!safe) {
    throw new Error('유효한 파일명을 입력해야 합니다.');
  }
  return `${safe}${extension}`;
}

module.exports = {
  createClientError,
  ensureAllowedPath,
  isPathInside,
  normalizeAbsolutePath,
  sanitizeFileName,
};
