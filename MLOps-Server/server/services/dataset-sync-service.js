'use strict';

const fs = require('fs');
const path = require('path');

const REQUEST_FILE = '.mlops-sync-request';
const STATUS_FILE = '.mlops-sync-status';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

class DatasetSyncService {
  constructor(runtimeConfig) {
    this.dataRoot = runtimeConfig.paths.dataRoot;
    this.enabled = process.env.MLOPS_DATASET_SYNC_ENABLED !== '0';
  }

  isEnabled() {
    return this.enabled;
  }

  getRequestPath() {
    return path.join(this.dataRoot, REQUEST_FILE);
  }

  getStatusPath() {
    return path.join(this.dataRoot, STATUS_FILE);
  }

  getStatus() {
    const status = readJsonFile(this.getStatusPath());
    return status || { state: 'idle', requestId: null, updatedAt: null };
  }

  async requestSync(options = {}) {
    if (!this.enabled) {
      return {
        synced: false,
        skipped: true,
        reason: '학습 서버 동기화가 비활성화되어 있습니다.',
      };
    }

    const timeoutMs = options.timeoutMs || 120000;
    const requestId = String(Date.now());
    const startedAt = Date.now();

    fs.writeFileSync(this.getRequestPath(), requestId, 'utf8');

    while (Date.now() - startedAt < timeoutMs) {
      const status = this.getStatus();
      if (status.requestId === String(requestId)) {
        if (status.state === 'ok') {
          return {
            synced: true,
            requestId,
            updatedAt: status.updatedAt,
            message: status.message || '학습 서버 dataset 동기화가 완료되었습니다.',
          };
        }
        if (status.state === 'error') {
          throw new Error(status.message || '학습 서버 dataset 동기화에 실패했습니다.');
        }
      }
      await sleep(500);
    }

    throw new Error('학습 서버 dataset 동기화 시간이 초과되었습니다.');
  }
}

module.exports = {
  DatasetSyncService,
};
