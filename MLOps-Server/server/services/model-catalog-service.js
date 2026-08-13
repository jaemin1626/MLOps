'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('../utils/atomic-json-file');
const { isRemoteMode } = require('./data-management-service');
const { toRelativeTrainingPath } = require('../utils/training-path-resolver');

const MODEL_EXTENSIONS = new Set(['.pt', '.pth', '.bin', '.safetensors', '.onnx']);
const REPRESENTATIVE_WEIGHT_PRIORITY = ['best.pt', 'last.pt'];
const VLM_CHECKPOINT_PRIORITY = ['final-lora', 'final', 'adapter_model.safetensors', 'model.safetensors'];
const JOB_STATUS_FOLDERS = ['running', 'completed', 'failed'];

class ModelCatalogService {
  constructor(runtimeConfig, trainingServerClient, onnxExportService = null, vlmTrainingServerClient = null) {
    this.config = runtimeConfig;
    this.client = trainingServerClient;
    this.vlmClient = vlmTrainingServerClient;
    this.onnxExportService = onnxExportService;
    this.modelRoot = runtimeConfig.paths.modelRoot;
    this.jobRoot = runtimeConfig.paths.jobRoot;
    fs.mkdirSync(this.modelRoot, { recursive: true });
  }

  usesRemoteApi() {
    return isRemoteMode(this.config.models) && this.client.isConfigured();
  }

  matchesModelId(model, modelId) {
    return model.id === modelId
      || model.folderName === modelId
      || model.sourceJobId === modelId;
  }

  async listModels(options = {}) {
    const verifyArtifacts = options.verifyArtifacts !== false;
    let models = [];
    if (this.usesRemoteApi()) {
      try {
        const remote = await this.client.listModels();
        const remoteModels = Array.isArray(remote.models) ? remote.models : [];
        if (remoteModels.length) {
          models = remoteModels;
        }
      } catch (error) {
        console.warn(`[ModelCatalogService] 원격 모델 목록 조회 실패, 로컬 상태 사용: ${error.message}`);
      }
    }
    if (!models.length) {
      models = this.listLocalModels();
    }
    const exports = this.onnxExportService
      ? this.onnxExportService.listLocalExports()
      : [];
    const enriched = models
      .map((model) => this.enrichModel(model, exports))
      .sort((left, right) => String(right.completedAt || '').localeCompare(String(left.completedAt || '')));
    if (!verifyArtifacts) {
      return enriched;
    }
    return Promise.all(enriched.map((model) => this.verifyModelArtifactIfNeeded(model)));
  }

  async getModel(modelId) {
    const exports = this.onnxExportService
      ? this.onnxExportService.listLocalExports()
      : [];
    let rawModel = null;

    if (this.usesRemoteApi()) {
      try {
        const remote = await this.client.listModels();
        rawModel = (Array.isArray(remote.models) ? remote.models : [])
          .find((model) => this.matchesModelId(model, modelId)) || null;
      } catch (error) {
        console.warn(`[ModelCatalogService] 원격 모델 상세 조회 실패, 로컬 상태 사용: ${error.message}`);
      }
    }
    if (!rawModel) {
      rawModel = this.findLocalModelById(modelId);
    }
    if (!rawModel) {
      return null;
    }
    const enriched = this.enrichModel(rawModel, exports);
    return this.verifyModelArtifactIfNeeded(enriched);
  }

  buildLocalModelEntry(entryName, modelDirectory) {
    const metadata = readJsonFile(path.join(modelDirectory, 'model-metadata.json'), {});
    const files = fs.readdirSync(modelDirectory, { withFileTypes: true })
      .filter((file) => file.isFile() && MODEL_EXTENSIONS.has(path.extname(file.name).toLowerCase()))
      .map((file) => {
        const filePath = path.join(modelDirectory, file.name);
        const stats = fs.statSync(filePath);
        return {
          name: file.name,
          path: filePath,
          extension: path.extname(file.name).toLowerCase(),
          sizeBytes: stats.size,
        };
      });
    return {
      id: entryName,
      folderName: entryName,
      folderPath: modelDirectory,
      modelName: metadata.modelName || entryName,
      modelType: metadata.modelType || '알 수 없음',
      trainingType: metadata.trainingType || 'unknown',
      sourceJobId: metadata.sourceJobId || null,
      datasetPath: metadata.datasetPath || '-',
      finalEpoch: metadata.finalEpoch ?? '-',
      finalStep: metadata.finalStep ?? '-',
      finalLoss: metadata.finalLoss ?? '-',
      learningRate: metadata.learningRate ?? null,
      completedAt: metadata.completedAt || fs.statSync(modelDirectory).mtime.toISOString(),
      modelFile: metadata.modelFile || null,
      remoteModelFile: metadata.remoteModelFile || null,
      status: this.resolveInitialModelStatus(metadata, files),
      files,
    };
  }

  findLocalModelById(modelId) {
    for (const entry of fs.readdirSync(this.modelRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const model = this.buildLocalModelEntry(entry.name, path.join(this.modelRoot, entry.name));
      if (this.matchesModelId(model, modelId)) {
        return model;
      }
    }
    return null;
  }

  listLocalModels() {
    const models = [];
    for (const entry of fs.readdirSync(this.modelRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      models.push(this.buildLocalModelEntry(entry.name, path.join(this.modelRoot, entry.name)));
    }
    return models;
  }

  resolveInitialModelStatus(metadata, files) {
    if (files.length) {
      return metadata.status || 'completed';
    }
    if (metadata.status === 'completed' && (metadata.remoteModelFile || metadata.modelFile)) {
      return 'completed';
    }
    return 'model_file_missing';
  }

  resolveModelArtifactPath(model) {
    const workspaceRoot = this.config.training?.workspaceRoot || '/workspace';
    const raw = model.remoteModelFile || model.modelFile;
    if (!raw) {
      return '';
    }
    return toRelativeTrainingPath(String(raw), workspaceRoot).replace(/^\/+/, '');
  }

  resolveTrainingClient(model) {
    return model.trainingType === 'vlm' ? this.vlmClient : this.client;
  }

  async verifyRemoteModelArtifact(model, relativePath) {
    const client = this.resolveTrainingClient(model);
    if (!client?.isConfigured()) {
      return { exists: Boolean(relativePath), markerFile: null, unchecked: true };
    }

    const normalized = String(relativePath).replace(/\\/g, '/').replace(/\/+$/, '');
    const markers = model.trainingType === 'vlm'
      ? ['adapter_config.json', 'config.json', 'adapter_model.safetensors', 'model.safetensors']
      : ['best.pt', 'last.pt'];

    for (const marker of markers) {
      const candidate = `${normalized}/${marker}`;
      try {
        await client.getWorkspaceFile(candidate);
        return { exists: true, markerFile: marker };
      } catch (_error) {
        // try next marker
      }
    }

    if (path.posix.extname(normalized)) {
      try {
        await client.getWorkspaceFile(normalized);
        return { exists: true, markerFile: path.posix.basename(normalized) };
      } catch (_error) {
        return { exists: false, markerFile: null };
      }
    }

    return { exists: false, markerFile: null };
  }

  async verifyModelArtifactIfNeeded(model) {
    const hasLocalFiles = Array.isArray(model.files) && model.files.length > 0;
    const artifactPath = this.resolveModelArtifactPath(model);
    const needsRemoteCheck = model.trainingType === 'vlm' || Boolean(model.remoteModelFile);

    if (!needsRemoteCheck || hasLocalFiles) {
      return model;
    }
    if (!artifactPath) {
      return { ...model, status: 'model_file_missing', modelArtifactVerified: false };
    }

    const verification = await this.verifyRemoteModelArtifact(model, artifactPath);
    if (!verification.exists) {
      return {
        ...model,
        status: 'model_file_missing',
        modelArtifactPath: artifactPath,
        modelArtifactVerified: false,
      };
    }

    return {
      ...model,
      status: 'completed',
      modelArtifactPath: artifactPath,
      modelArtifactVerified: verification.unchecked ? null : true,
      modelArtifactMarker: verification.markerFile || null,
    };
  }

  enrichModel(model, exports) {
    const relatedExports = exports
      .filter((exportItem) => this.exportMatchesModel(exportItem, model))
      .sort((left, right) => String(right.completedAt || right.startedAt || '').localeCompare(String(left.completedAt || left.startedAt || '')));
    const weightFiles = this.collectWeightFiles(model, relatedExports);
    const representativeWeight = this.pickRepresentativeWeight(weightFiles);
    const deployment = this.buildDeploymentSummary(relatedExports, model);
    const learningRate = this.resolveLearningRate(model);

    return {
      ...model,
      learningRate,
      learningRateLabel: this.formatLearningRate(learningRate),
      trainingInfo: this.formatTrainingInfo(model, learningRate),
      weightFiles,
      representativeWeight,
      deploymentStatus: deployment.status,
      deploymentStatusLabel: deployment.statusLabel,
      latestExport: deployment.latestExport,
      exports: relatedExports,
    };
  }

  resolveJobRecord(sourceJobId) {
    if (!sourceJobId) return null;
    for (const folder of JOB_STATUS_FOLDERS) {
      const jobPath = path.join(this.jobRoot, folder, sourceJobId, 'job.json');
      if (fs.existsSync(jobPath)) {
        return readJsonFile(jobPath, {});
      }
    }
    return null;
  }

  resolveLearningRate(model) {
    const direct = Number(model.learningRate);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const job = this.resolveJobRecord(model.sourceJobId);
    const fromParameters = Number(job?.parameters?.learningRate);
    if (Number.isFinite(fromParameters) && fromParameters > 0) return fromParameters;

    const command = String(job?.command || '');
    const match = command.match(/--learning-rate\s+([\d.eE+-]+)/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return null;
  }

  formatLearningRate(value) {
    if (value == null || !Number.isFinite(Number(value))) return '-';
    const number = Number(value);
    if (number >= 1) return String(number);
    return String(number).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  }

  formatTrainingInfo(model, learningRate = null) {
    const epoch = model.finalEpoch ?? '-';
    const rateLabel = this.formatLearningRate(
      learningRate != null ? learningRate : this.resolveLearningRate(model),
    );
    return `Epoch ${epoch} · LR ${rateLabel}`;
  }

  collectWeightFiles(model, relatedExports) {
    const fileMap = new Map();
    const addFile = (name, filePath, source) => {
      const normalizedName = String(name || '').trim();
      if (!normalizedName) return;
      if (fileMap.has(normalizedName)) return;
      fileMap.set(normalizedName, {
        name: normalizedName,
        path: String(filePath || '').trim(),
        source,
      });
    };

    for (const file of model.files || []) {
      addFile(file.name, file.path, 'catalog');
    }

    const modelFile = model.modelFile || model.remoteModelFile || model.modelArtifactPath;
    if (modelFile) {
      const normalized = String(modelFile).replace(/\\/g, '/').replace(/\/+$/, '');
      const baseName = path.posix.basename(normalized) || 'checkpoint';
      addFile(baseName, normalized, 'training');

      if (model.trainingType === 'vlm' || !path.posix.extname(normalized)) {
        addFile('adapter_config.json', `${normalized}/adapter_config.json`, 'training');
        addFile('adapter_model.safetensors', `${normalized}/adapter_model.safetensors`, 'training');
        addFile('model.safetensors', `${normalized}/model.safetensors`, 'training');
      }

      if (normalized.includes('/weights/')) {
        const weightsDir = normalized.slice(0, normalized.lastIndexOf('/'));
        addFile('best.pt', `${weightsDir}/best.pt`, 'training');
        addFile('last.pt', `${weightsDir}/last.pt`, 'training');
      }
    }

    for (const exportItem of relatedExports) {
      addFile(
        exportItem.sourcePtFileName,
        exportItem.sourcePtPath || exportItem.parameters?.sourcePtPath,
        'export',
      );
    }

    return Array.from(fileMap.values()).sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }

  pickRepresentativeWeight(weightFiles) {
    if (!weightFiles.length) {
      return { name: '-', extraCount: 0, path: '' };
    }
    for (const preferredName of VLM_CHECKPOINT_PRIORITY) {
      const match = weightFiles.find((file) => file.name === preferredName);
      if (match) {
        return {
          name: match.name,
          path: match.path,
          extraCount: Math.max(0, weightFiles.length - 1),
        };
      }
    }
    for (const preferredName of REPRESENTATIVE_WEIGHT_PRIORITY) {
      const match = weightFiles.find((file) => file.name === preferredName);
      if (match) {
        return {
          name: match.name,
          path: match.path,
          extraCount: Math.max(0, weightFiles.length - 1),
        };
      }
    }
    const adapter = weightFiles.find((file) => file.name.startsWith('adapter_model'));
    if (adapter) {
      return {
        name: adapter.name,
        path: adapter.path,
        extraCount: Math.max(0, weightFiles.length - 1),
      };
    }
    const first = weightFiles[0];
    return {
      name: first.name,
      path: first.path,
      extraCount: Math.max(0, weightFiles.length - 1),
    };
  }

  isDeploymentSupported(model) {
    return !(model.trainingType === 'vlm' || model.modelType === 'VLM');
  }

  buildDeploymentSummary(relatedExports, model = {}) {
    if (!this.isDeploymentSupported(model)) {
      return {
        status: 'not_applicable',
        statusLabel: '-',
        latestExport: null,
      };
    }
    const completed = relatedExports.filter((item) => item.status === 'completed');
    const running = relatedExports.filter((item) => item.status === 'running');
    const failed = relatedExports.filter((item) => item.status === 'failed');
    const latestCompleted = completed[0] || null;
    const latestRunning = running[0] || null;
    const latestFailed = failed[0] || null;

    if (latestCompleted) {
      return {
        status: 'deployed',
        statusLabel: '배포 완료',
        latestExport: latestCompleted,
      };
    }
    if (latestRunning) {
      return {
        status: 'deploying',
        statusLabel: '배포 중',
        latestExport: latestRunning,
      };
    }
    if (latestFailed) {
      return {
        status: 'failed',
        statusLabel: '배포 실패',
        latestExport: latestFailed,
      };
    }
    return {
      status: 'not_deployed',
      statusLabel: '미배포',
      latestExport: null,
    };
  }

  exportMatchesModel(exportItem, model) {
    const modelName = String(model.modelName || '');
    const folderName = String(model.folderName || '');
    const exportName = String(exportItem.modelName || '');
    const sourcePath = String(
      exportItem.sourcePtPath
      || exportItem.parameters?.sourcePtPath
      || '',
    ).replace(/\\/g, '/');
    const relativePath = String(
      exportItem.parameters?.sourcePtRelativePath
      || exportItem.sourcePtRelativePath
      || toRelativeTrainingPath(sourcePath, this.config.training?.workspaceRoot || '/workspace')
      || '',
    ).replace(/\\/g, '/');

    if (exportName && exportName === modelName) return true;
    if (folderName && (sourcePath.includes(folderName) || relativePath.includes(folderName))) return true;
    if (modelName && (sourcePath.includes(modelName) || relativePath.includes(modelName))) return true;
    return false;
  }

  async findModelByFilePath(filePath) {
    const models = await this.listModels();
    const normalized = String(filePath || '').replace(/\\/g, '/');
    return models.find((model) => (
      model.files.some((file) => String(file.path).replace(/\\/g, '/') === normalized)
      || String(model.modelFile || '').replace(/\\/g, '/') === normalized
    )) || null;
  }
}

module.exports = {
  ModelCatalogService,
};
