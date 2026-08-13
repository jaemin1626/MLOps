'use strict';

const path = require('path');
const { getTrainingWorkspaceRoot } = require('../utils/training-path-resolver');
const { isRemoteMode } = require('./data-management-service');

class PseudoLabelService {
  constructor(runtimeConfig, trainingServerClient) {
    this.config = runtimeConfig;
    this.client = trainingServerClient;
    this.dataRoot = String(runtimeConfig.paths.dataRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
    this.workspaceRoot = getTrainingWorkspaceRoot(runtimeConfig);
  }

  usesRemoteApi() {
    return isRemoteMode(this.config.training) && this.client.isConfigured();
  }

  resolveAgentDatasetPath(inputPath) {
    const normalized = String(inputPath || '').trim().replace(/\\/g, '/');
    if (!normalized) {
      throw new Error('이미지 폴더 경로가 필요합니다.');
    }

    const workspaceRoot = this.workspaceRoot.replace(/\/+$/, '');
    const datasetRootOnAgent = `${workspaceRoot}/dataset`;

    if (normalized.startsWith(`${datasetRootOnAgent}/`) || normalized === datasetRootOnAgent) {
      return normalized;
    }
    if (normalized.startsWith('/workspace/dataset/') || normalized === '/workspace/dataset') {
      return normalized.replace(/^\/workspace/, workspaceRoot);
    }

    if (this.dataRoot && normalized.startsWith(`${this.dataRoot}/`)) {
      const suffix = normalized.slice(this.dataRoot.length).replace(/^\/+/, '');
      return path.posix.join(datasetRootOnAgent, suffix);
    }

    const imagesIndex = normalized.indexOf('/Images/');
    if (imagesIndex >= 0) {
      return path.posix.join(datasetRootOnAgent, normalized.slice(imagesIndex + 1));
    }

    if (normalized.startsWith('dataset/')) {
      return path.posix.join(workspaceRoot, normalized);
    }

    throw new Error(`학습 서버 dataset 경로로 변환하지 못했습니다: ${normalized}`);
  }

  resolveAgentImagePath(inputPath, imageDirectoryOnAgent) {
    const normalized = String(inputPath || '').trim().replace(/\\/g, '/');
    if (!normalized) {
      throw new Error('이미지 경로가 필요합니다.');
    }
    if (normalized.startsWith(`${this.workspaceRoot}/`) || normalized.startsWith('/workspace/')) {
      return normalized.replace(/^\/workspace/, this.workspaceRoot);
    }
    if (path.posix.isAbsolute(normalized)) {
      return this.resolveAgentDatasetPath(normalized);
    }
    return path.posix.join(imageDirectoryOnAgent.replace(/\/+$/, ''), normalized.replace(/^\/+/, ''));
  }

  normalizeSourcePtPath(sourcePtPath) {
    const trimmed = String(sourcePtPath || '').trim().replace(/\\/g, '/');
    if (!trimmed) {
      throw new Error('.pt 모델 경로가 필요합니다.');
    }
    if (trimmed.startsWith(`${this.workspaceRoot}/`)) {
      return trimmed.slice(this.workspaceRoot.length).replace(/^\/+/, '');
    }
    if (trimmed.startsWith('/workspace/')) {
      return trimmed.slice('/workspace/'.length);
    }
    return trimmed.replace(/^\/+/, '');
  }

  buildAgentPayload(input) {
    const imageDirectory = this.resolveAgentDatasetPath(input.imageDirectory);
    const payload = {
      sourcePtPath: this.normalizeSourcePtPath(input.sourcePtPath),
      imageDirectory,
      scope: String(input.scope || 'all'),
      conf: Number(input.conf ?? input.confThres ?? 0.25),
      iou: Number(input.iou ?? input.iouThres ?? 0.45),
      overwrite: Boolean(input.overwrite),
    };

    if (Array.isArray(input.classNames) && input.classNames.length) {
      payload.classNames = input.classNames;
    }

    if (Array.isArray(input.imagePaths) && input.imagePaths.length) {
      payload.imagePaths = input.imagePaths.map((imagePath) => (
        this.resolveAgentImagePath(imagePath, imageDirectory)
      ));
    } else if (input.imagePath) {
      payload.imagePaths = [this.resolveAgentImagePath(input.imagePath, imageDirectory)];
      payload.scope = 'current';
    }

    return payload;
  }

  async runPseudoLabel(input) {
    if (!this.usesRemoteApi()) {
      throw new Error('pseudo labeling은 학습 서버 remote 모드에서만 지원합니다.');
    }
    const payload = this.buildAgentPayload(input);
    const timeoutMs = Number(input.timeoutMs || this.config.training?.requestTimeoutMs || 30000);
    const estimatedImages = payload.imagePaths?.length || Number(input.estimatedCount || 1);
    const dynamicTimeout = Math.max(timeoutMs, estimatedImages * 4000);
    return this.client.runPseudoLabel(payload, { timeoutMs: dynamicTimeout });
  }
}

module.exports = {
  PseudoLabelService,
};
