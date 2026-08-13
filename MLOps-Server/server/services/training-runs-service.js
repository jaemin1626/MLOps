'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('../utils/atomic-json-file');
const { getTrainingWorkspaceRoot } = require('../utils/training-path-resolver');
const { statRemoteWorkspaceFile } = require('../utils/remote-workspace-file-fetch');
const { isRemoteMode } = require('./data-management-service');

const JOB_STATUS_FOLDERS = ['running', 'completed', 'failed'];

class TrainingRunsService {
  constructor(runtimeConfig, trainingServerClient) {
    this.config = runtimeConfig;
    this.client = trainingServerClient;
    this.jobRoot = runtimeConfig.paths.jobRoot;
    this.modelRoot = runtimeConfig.paths.modelRoot;
    this.workspaceRoot = getTrainingWorkspaceRoot(runtimeConfig);
    this.runsRoot = String(runtimeConfig.training?.runsRoot || 'detector/runs')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
  }

  usesRemoteApi() {
    return isRemoteMode(this.config.training) && this.client.isConfigured();
  }

  isRemoteRunsApiUnavailable(error) {
    const message = String(error?.message || '');
    return message.includes('404') || message.includes('JSON 응답을 해석하지 못했습니다');
  }

  markRemoteRunsApiUnavailable(error) {
    if (!this.remoteRunsApiUnavailable) {
      console.warn('[TrainingRunsService] 학습 서버 runs API를 사용할 수 없어 로컬 catalog fallback을 사용합니다.');
      if (error?.message) {
        console.warn(`[TrainingRunsService] 원격 runs API 오류: ${error.message.split('\n')[0]}`);
      }
    }
    this.remoteRunsApiUnavailable = true;
  }

  shouldSkipRemoteRunsApi() {
    return Boolean(this.remoteRunsApiUnavailable);
  }

  getRunsRootRelative() {
    return this.runsRoot;
  }

  resolveRunsAbsolutePath() {
    return path.posix.join(this.workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, ''), this.runsRoot);
  }

  resolveRunFolderPath(folderName) {
    const normalizedFolder = String(folderName || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedFolder || normalizedFolder.includes('..') || normalizedFolder.includes('/')) {
      throw new Error('가중치 폴더명이 올바르지 않습니다.');
    }
    return path.posix.join(this.resolveRunsAbsolutePath(), normalizedFolder);
  }

  normalizeRelativePtPath(inputPath) {
    const trimmed = String(inputPath || '').trim().replace(/\\/g, '/');
    if (!trimmed) return '';
    const workspacePrefix = `${this.workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
    if (trimmed.startsWith(workspacePrefix)) {
      return trimmed.slice(workspacePrefix.length);
    }
    return trimmed.replace(/^\/+/, '');
  }

  extractRunFolderName(relativePath) {
    const normalized = this.normalizeRelativePtPath(relativePath);
    const prefix = `${this.runsRoot}/`;
    if (!normalized.startsWith(prefix)) return '';
    const rest = normalized.slice(prefix.length);
    return rest.split('/').filter(Boolean)[0] || '';
  }

  collectKnownPtPaths() {
    const paths = new Set();

    const addPath = (value) => {
      const normalized = this.normalizeRelativePtPath(value);
      if (normalized.endsWith('.pt') && normalized.startsWith(`${this.runsRoot}/`)) {
        paths.add(normalized);
      }
    };

    for (const statusFolder of JOB_STATUS_FOLDERS) {
      const statusRoot = path.join(this.jobRoot, statusFolder);
      if (!fs.existsSync(statusRoot)) continue;
      for (const entry of fs.readdirSync(statusRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const jobDirectory = path.join(statusRoot, entry.name);
        const progress = readJsonFile(path.join(jobDirectory, 'progress.json'), {});
        const job = readJsonFile(path.join(jobDirectory, 'job.json'), {});
        addPath(progress.modelFile);
        addPath(progress.remoteModelFile);
        addPath(job.modelFile);
      }
    }

    if (fs.existsSync(this.modelRoot)) {
      for (const entry of fs.readdirSync(this.modelRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const metadata = readJsonFile(path.join(this.modelRoot, entry.name, 'model-metadata.json'), {});
        addPath(metadata.modelFile);
        addPath(metadata.remoteModelFile);
      }
    }

    return paths;
  }

  listFoldersFromLocalCatalog() {
    const folderMap = new Map();
    for (const relativePath of this.collectKnownPtPaths()) {
      const folderName = this.extractRunFolderName(relativePath);
      if (!folderName) continue;
      folderMap.set(folderName, {
        name: folderName,
        path: path.posix.join(this.runsRoot, folderName),
      });
    }

    const folders = Array.from(folderMap.values())
      .sort((left, right) => left.name.localeCompare(right.name, 'ko'));

    return {
      runsRoot: this.runsRoot,
      runsAbsolutePath: this.resolveRunsAbsolutePath(),
      folders,
      source: 'local-catalog',
      hint: folders.length
        ? '학습 이력/모델 메타데이터에서 가중치 폴더를 구성했습니다. agent 업데이트 후 최신 목록을 불러올 수 있습니다.'
        : '가중치 폴더가 없습니다. 학습 완료 후 다시 시도하거나 학습 서버 agent를 재빌드하세요.',
    };
  }

  resolveLocalPtFilePath(relativePath) {
    const normalized = this.normalizeRelativePtPath(relativePath);
    if (!normalized) return '';
    const workspaceRoot = this.workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    return path.join(workspaceRoot, normalized);
  }

  resolvePtFileSizeLocal(file) {
    const existing = Number(file?.sizeBytes) || 0;
    if (existing > 0) {
      return existing;
    }

    const localPath = this.resolveLocalPtFilePath(file.relativePath);
    if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
      return fs.statSync(localPath).size;
    }

    return 0;
  }

  async enrichPtFileSizes(files, folderName = '') {
    if (!Array.isArray(files) || !files.length) {
      return files;
    }

    const sizeMap = new Map();
    if (this.client?.isConfigured() && folderName) {
      try {
        const remote = await this.client.listRunPtFiles(folderName);
        for (const item of remote.files || []) {
          if (item.relativePath && Number(item.sizeBytes) > 0) {
            sizeMap.set(item.relativePath, Number(item.sizeBytes));
          }
        }
      } catch (_error) {
        // fallback to stat API / SSH stat
      }
    }

    return Promise.all(files.map(async (file) => {
      let sizeBytes = sizeMap.get(file.relativePath) || this.resolvePtFileSizeLocal(file);

      if (sizeBytes <= 0 && this.client?.isConfigured()) {
        try {
          const stat = await this.client.statWorkspaceFile(file.relativePath);
          sizeBytes = Number(stat.sizeBytes) || 0;
        } catch (_error) {
          // try SSH stat fallback
        }
      }

      if (sizeBytes <= 0) {
        sizeBytes = statRemoteWorkspaceFile(file.relativePath);
      }

      return { ...file, sizeBytes };
    }));
  }

  listPtFilesFromLocalCatalog(folderName) {
    const normalizedFolder = String(folderName || '').trim();
    const prefix = `${this.runsRoot}/${normalizedFolder}/`;
    const files = [];

    for (const relativePath of this.collectKnownPtPaths()) {
      if (!relativePath.startsWith(prefix)) continue;
      files.push({
        name: path.posix.basename(relativePath),
        relativePath,
        path: path.posix.join(this.workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, ''), relativePath),
        sizeBytes: this.resolvePtFileSizeLocal({ relativePath }),
      });
    }

    const defaults = ['weights/best.pt', 'weights/last.pt'];
    for (const suffix of defaults) {
      const relativePath = path.posix.join(this.runsRoot, normalizedFolder, suffix);
      if (files.some((file) => file.relativePath === relativePath)) continue;
      files.push({
        name: path.posix.basename(relativePath),
        relativePath,
        path: path.posix.join(this.workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, ''), relativePath),
        sizeBytes: this.resolvePtFileSizeLocal({ relativePath }),
      });
    }

    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'ko'));
    return {
      folder: normalizedFolder,
      folderPath: path.posix.join(this.runsRoot, normalizedFolder),
      files,
      source: 'local-catalog',
    };
  }

  async listRunFolders() {
    if (this.usesRemoteApi() && !this.shouldSkipRemoteRunsApi()) {
      try {
        const remote = await this.client.listRunFolders();
        if (Array.isArray(remote.folders) && remote.folders.length) {
          return remote;
        }
        const fallback = this.listFoldersFromLocalCatalog();
        if (fallback.folders.length) {
          return fallback;
        }
        return remote;
      } catch (error) {
        if (this.isRemoteRunsApiUnavailable(error)) {
          this.markRemoteRunsApiUnavailable(error);
        } else {
          console.warn(`[TrainingRunsService] 원격 가중치 폴더 조회 실패, 로컬 catalog fallback: ${error.message}`);
        }
        return this.listFoldersFromLocalCatalog();
      }
    }
    const local = this.listLocalRunFolders();
    if (local.folders.length) {
      return local;
    }
    return this.listFoldersFromLocalCatalog();
  }

  listLocalRunFolders() {
    const runsAbsolutePath = this.resolveRunsAbsolutePath();
    if (!fs.existsSync(runsAbsolutePath)) {
      return {
        runsRoot: this.runsRoot,
        runsAbsolutePath,
        folders: [],
        hint: `가중치 폴더가 없습니다: ${runsAbsolutePath}`,
      };
    }

    const folders = fs.readdirSync(runsAbsolutePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.posix.join(this.runsRoot, entry.name),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'ko'));

    return { runsRoot: this.runsRoot, runsAbsolutePath, folders };
  }

  async listPtFiles(folderName) {
    const normalizedFolder = String(folderName || '').trim();
    let result;

    if (this.usesRemoteApi() && !this.shouldSkipRemoteRunsApi()) {
      try {
        const remote = await this.client.listRunPtFiles(normalizedFolder);
        if (Array.isArray(remote.files) && remote.files.length) {
          result = remote;
        } else {
          const fallback = this.listPtFilesFromLocalCatalog(normalizedFolder);
          result = fallback.files.length ? fallback : remote;
        }
      } catch (error) {
        if (this.isRemoteRunsApiUnavailable(error)) {
          this.markRemoteRunsApiUnavailable(error);
        } else {
          console.warn(`[TrainingRunsService] 원격 .pt 목록 조회 실패, 로컬 catalog fallback: ${error.message}`);
        }
        const fallback = this.listPtFilesFromLocalCatalog(normalizedFolder);
        if (fallback.files.length) {
          result = fallback;
        } else {
          throw error;
        }
      }
    } else {
      try {
        result = this.listLocalPtFiles(normalizedFolder);
      } catch (error) {
        const fallback = this.listPtFilesFromLocalCatalog(normalizedFolder);
        if (fallback.files.length) {
          result = fallback;
        } else {
          throw error;
        }
      }
    }

    if (result?.files?.length) {
      result.files = await this.enrichPtFileSizes(result.files, normalizedFolder);
    }
    return result;
  }

  listLocalPtFiles(folderName) {
    const folderPath = this.resolveRunFolderPath(folderName);
    if (!fs.existsSync(folderPath)) {
      throw new Error(`가중치 폴더를 찾을 수 없습니다: ${folderPath}`);
    }

    const files = [];
    const visit = (currentPath) => {
      for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
        const entryPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath);
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.pt') {
          continue;
        }
        const stats = fs.statSync(entryPath);
        const relativePath = path.posix.join(
          this.runsRoot,
          folderName,
          path.relative(folderPath, entryPath).split(path.sep).join('/'),
        );
        files.push({
          name: entry.name,
          relativePath,
          path: entryPath,
          sizeBytes: stats.size,
        });
      }
    };
    visit(folderPath);

    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'ko'));
    return {
      folder: folderName,
      folderPath: path.posix.join(this.runsRoot, folderName),
      files,
    };
  }
}

module.exports = {
  TrainingRunsService,
};
