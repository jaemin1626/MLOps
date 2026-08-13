'use strict';

const fs = require('fs');
const path = require('path');
const {
  getTrainingWorkspaceRoot,
  toRelativeTrainingPath,
} = require('../utils/training-path-resolver');

const REQUEST_FILE = '.mlops-weights-list-request';
const INDEX_FILE = '.mlops-weights-index.json';
const STALE_MS = 5 * 60 * 1000;

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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class DetectorWeightsService {
  constructor(runtimeConfig, trainingRunsService = null) {
    this.dataRoot = runtimeConfig.paths.dataRoot;
    this.workspaceRoot = getTrainingWorkspaceRoot(runtimeConfig);
    this.weightsRoot = String(
      runtimeConfig.training?.weightsRoot
      || 'detector/weights',
    ).trim().replace(/\\/g, '/').replace(/^\/+/, '');
    this.runsRoot = String(
      runtimeConfig.training?.runsRoot
      || 'detector/runs',
    ).trim().replace(/\\/g, '/').replace(/^\/+/, '');
    this.trainingRunsService = trainingRunsService;
    this.enabled = process.env.MLOPS_DATASET_SYNC_ENABLED !== '0';
  }

  getRequestPath() {
    return path.join(this.dataRoot, REQUEST_FILE);
  }

  getIndexPath() {
    return path.join(this.dataRoot, INDEX_FILE);
  }

  isIndexStale(index) {
    if (!index?.updatedAt) {
      return true;
    }
    const updatedAt = Date.parse(index.updatedAt);
    if (!Number.isFinite(updatedAt)) {
      return true;
    }
    return Date.now() - updatedAt > STALE_MS;
  }

  requestRefresh() {
    if (!this.enabled) {
      return false;
    }
    fs.writeFileSync(this.getRequestPath(), String(Date.now()), 'utf8');
    return true;
  }

  async waitForRefresh(timeoutMs = 15000) {
    const startedAt = Date.now();
    const requestMarker = fs.existsSync(this.getRequestPath());
    while (Date.now() - startedAt < timeoutMs) {
      const index = readJsonFile(this.getIndexPath());
      if (index && !this.isIndexStale(index)) {
        return index;
      }
      if (requestMarker && !fs.existsSync(this.getRequestPath()) && index) {
        return index;
      }
      await sleep(300);
    }
    return readJsonFile(this.getIndexPath());
  }

  normalizeIndex(index) {
    const weightsRoot = toRelativeTrainingPath(index?.weightsRoot || this.weightsRoot, this.workspaceRoot)
      || this.weightsRoot;
    const weights = (index?.weights || []).map((item) => {
      const fallbackPath = `${weightsRoot.replace(/\/$/, '')}/${item.name}`;
      return {
        name: item.name,
        path: toRelativeTrainingPath(item.path || fallbackPath, this.workspaceRoot) || fallbackPath,
        sizeBytes: item.sizeBytes || 0,
        source: 'weights',
      };
    });
    return {
      workspaceRoot: index?.workspaceRoot || this.workspaceRoot,
      weightsRoot,
      runsRoot: this.runsRoot,
      updatedAt: index?.updatedAt || null,
      weights,
    };
  }

  async listRunWeights() {
    if (!this.trainingRunsService) {
      return [];
    }

    const foldersResult = await this.trainingRunsService.listRunFolders();
    const folders = foldersResult.folders || [];
    if (!folders.length) {
      return [];
    }

    const results = await Promise.all(folders.map(async (folder) => {
      const ptResult = await this.trainingRunsService.listPtFiles(folder.name);
      return (ptResult.files || []).map((file) => ({
        name: `${folder.name}/${file.name}`,
        path: file.relativePath,
        sizeBytes: file.sizeBytes || 0,
        source: 'runs',
        runFolder: folder.name,
        fileName: file.name,
      }));
    }));

    return results.flat().sort((left, right) => left.path.localeCompare(right.path, 'ko'));
  }

  async listWeights(options = {}) {
    let index = readJsonFile(this.getIndexPath());
    const shouldRefresh = options.refresh || !index || this.isIndexStale(index);
    if (shouldRefresh && this.requestRefresh()) {
      index = await this.waitForRefresh(options.timeoutMs || 15000);
    }
    const base = this.normalizeIndex(index || { weights: [], weightsRoot: this.weightsRoot });
    const runWeights = await this.listRunWeights();
    return {
      ...base,
      weights: [...base.weights, ...runWeights],
    };
  }
}

module.exports = {
  DetectorWeightsService,
};
