'use strict';

const path = require('path');
const { TrainingServerClient } = require('../clients/training-server-client');
const {
  TrainingConnectionRegistryService,
  sanitizeConnection,
} = require('./training-connection-registry-service');
const { DataManagementService } = require('./data-management-service');
const { DatasetSyncService } = require('./dataset-sync-service');
const { DetectorWeightsService } = require('./detector-weights-service');
const { DatasetConfigService } = require('./dataset-config-service');
const { TrainingJobService } = require('./training-job-service');
const { ModelCatalogService } = require('./model-catalog-service');
const { OnnxExportService } = require('./onnx-export-service');
const { TrainingRunsService } = require('./training-runs-service');
const { PseudoLabelService } = require('./pseudo-label-service');
const { ConnectionSshSessionService } = require('./connection-ssh-session-service');

function cloneRuntimeConfig(baseRuntimeConfig, connection, paths, sshSession = null) {
  const { detectorUrl, vlmUrl } = baseRuntimeConfig.connectionRegistry
    ? baseRuntimeConfig.connectionRegistry.buildAgentUrls(connection)
    : { detectorUrl: '', vlmUrl: '' };

  const trainingServer = {
    baseUrl: detectorUrl,
    requestTimeoutMs: baseRuntimeConfig.trainingServer.requestTimeoutMs,
    mlopsPublicBaseUrl: baseRuntimeConfig.trainingServer.mlopsPublicBaseUrl,
    authToken: connection.token,
  };
  const vlmTrainingServer = {
    baseUrl: vlmUrl,
    requestTimeoutMs: baseRuntimeConfig.vlmTrainingServer.requestTimeoutMs,
    mlopsPublicBaseUrl: baseRuntimeConfig.trainingServer.mlopsPublicBaseUrl,
    authToken: connection.token,
  };

  return {
    ...baseRuntimeConfig,
    connectionId: connection.connection_id,
    connection,
    allowedDataRoots: paths.allowedDataRoots,
    paths,
    trainingServer,
    vlmTrainingServer,
    ssh: {
      host: connection.host,
      user: sshSession?.user || connection.ssh_user,
      password: sshSession?.password || '',
      remoteWorkspaceRoot: connection.remote_workspace_root,
      remoteDatasetPath: connection.remote_dataset_path,
    },
    training: {
      ...baseRuntimeConfig.training,
      agentBaseUrl: detectorUrl,
      vlmAgentBaseUrl: vlmUrl,
      workspaceRoot: connection.workspace_root,
    },
    export: {
      ...baseRuntimeConfig.export,
      agentBaseUrl: detectorUrl,
    },
  };
}

class TrainingConnectionHub {
  constructor(baseRuntimeConfig, options = {}) {
    this.baseRuntimeConfig = baseRuntimeConfig;
    this.registry = options.registry
      || new TrainingConnectionRegistryService({
        workspaceRoot: baseRuntimeConfig.workspaceRoot || path.dirname(baseRuntimeConfig.paths.jobRoot),
      });
    this.baseRuntimeConfig.connectionRegistry = this.registry;
    this.sshSessionService = options.sshSessionService || new ConnectionSshSessionService();
    this.scopeCache = new Map();
    this.clientCache = new Map();
  }

  clearCache(connectionId) {
    if (connectionId) {
      this.scopeCache.delete(connectionId);
      this.clientCache.delete(`${connectionId}:detector`);
      this.clientCache.delete(`${connectionId}:vlm`);
      return;
    }
    this.scopeCache.clear();
    this.clientCache.clear();
  }

  resolvePaths(connection) {
    if (connection.legacy_paths) {
      return {
        dataRoot: this.baseRuntimeConfig.paths.dataRoot,
        jobRoot: this.baseRuntimeConfig.paths.jobRoot,
        modelRoot: this.baseRuntimeConfig.paths.modelRoot,
        exportRoot: this.baseRuntimeConfig.paths.exportRoot,
        logRoot: this.baseRuntimeConfig.paths.logRoot,
        allowedDataRoots: this.baseRuntimeConfig.allowedDataRoots,
      };
    }

    const workspaceRoot = this.baseRuntimeConfig.workspaceRoot
      || path.dirname(this.baseRuntimeConfig.paths.jobRoot);
    const connectionRoot = path.join(workspaceRoot, 'connections', connection.connection_id);
    const dataRoot = path.join(connectionRoot, 'dataset');
    return {
      dataRoot,
      jobRoot: path.join(connectionRoot, 'jobs'),
      modelRoot: path.join(connectionRoot, 'models'),
      exportRoot: path.join(connectionRoot, 'exports'),
      logRoot: path.join(connectionRoot, 'logs'),
      allowedDataRoots: [dataRoot],
    };
  }

  getClient(connection, kind = 'detector') {
    const cacheKey = `${connection.connection_id}:${kind}`;
    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey);
    }
    const urls = this.registry.buildAgentUrls(connection);
    const runtimeConfig = cloneRuntimeConfig(
      this.baseRuntimeConfig,
      connection,
      this.resolvePaths(connection),
    );
    const client = new TrainingServerClient({
      ...runtimeConfig,
      trainingServer: kind === 'vlm'
        ? { ...runtimeConfig.vlmTrainingServer, baseUrl: urls.vlmUrl }
        : { ...runtimeConfig.trainingServer, baseUrl: urls.detectorUrl },
    });
    this.clientCache.set(cacheKey, client);
    return client;
  }

  resolveScope(requestedConnectionId) {
    const activeId = this.sshSessionService.getActiveConnectionId();
    if (!activeId) {
      const error = new Error('연결된 학습 서버가 없습니다. Connection 관리에서 SSH 연결하세요.');
      error.statusCode = 401;
      throw error;
    }

    const requested = String(requestedConnectionId || '').trim() || activeId;
    if (requested !== activeId) {
      const activeConnection = this.registry.getById(activeId);
      const error = new Error(
        `현재 "${activeConnection?.name || '다른 학습 서버'}" 에 연결 중입니다. `
        + 'Connection 관리에서 SSH 연결로 전환하세요.',
      );
      error.statusCode = 409;
      error.activeConnectionId = activeId;
      throw error;
    }

    return this.buildScope(activeId);
  }

  buildScope(connectionId) {
    const connection = this.registry.requireById(connectionId);
    const sshSession = this.sshSessionService.requireSession(connection.connection_id);
    if (this.scopeCache.has(connection.connection_id)) {
      const cached = this.scopeCache.get(connection.connection_id);
      if (cached.runtimeConfig.ssh.password === (sshSession?.password || '')) {
        return cached;
      }
      this.clearCache(connection.connection_id);
    }

    const paths = this.resolvePaths(connection);
    Object.values({
      dataRoot: paths.dataRoot,
      jobRoot: paths.jobRoot,
      modelRoot: paths.modelRoot,
      exportRoot: paths.exportRoot,
      logRoot: paths.logRoot,
    }).forEach((directory) => {
      require('fs').mkdirSync(directory, { recursive: true });
    });
    const runtimeConfig = cloneRuntimeConfig(
      this.baseRuntimeConfig,
      connection,
      paths,
      sshSession,
    );
    const detectorClient = this.getClient(connection, 'detector');
    const vlmClient = this.getClient(connection, 'vlm');
    const trainingRunsService = new TrainingRunsService(runtimeConfig, detectorClient);
    const detectorWeightsService = new DetectorWeightsService(runtimeConfig, trainingRunsService);
    const datasetConfigService = new DatasetConfigService(runtimeConfig);
    const trainingJobService = new TrainingJobService(runtimeConfig, detectorClient, vlmClient);
    const modelCatalogService = new ModelCatalogService(
      runtimeConfig,
      detectorClient,
      null,
      vlmClient,
    );
    const onnxExportService = new OnnxExportService(runtimeConfig, modelCatalogService, detectorClient);
    modelCatalogService.onnxExportService = onnxExportService;

    const scope = {
      connection,
      runtimeConfig,
      paths,
      allowedDataRoots: paths.allowedDataRoots,
      detectorClient,
      vlmClient,
      dataManagementService: new DataManagementService(runtimeConfig, detectorClient),
      datasetSyncService: new DatasetSyncService(runtimeConfig),
      detectorWeightsService,
      datasetConfigService,
      trainingJobService,
      modelCatalogService,
      trainingRunsService,
      onnxExportService,
      pseudoLabelService: new PseudoLabelService(runtimeConfig, detectorClient),
    };
    this.scopeCache.set(connection.connection_id, scope);
    return scope;
  }

  connectConnection(connectionId, input = {}) {
    const previousConnectionId = this.sshSessionService.getActiveConnectionId();
    const connection = this.registry.authenticateConnection(connectionId, input, {
      sshSessionService: this.sshSessionService,
    });
    this.clearCache();
    return {
      connection,
      previousConnectionId: previousConnectionId && previousConnectionId !== connectionId
        ? previousConnectionId
        : null,
      switched: Boolean(previousConnectionId && previousConnectionId !== connectionId),
    };
  }

  createConnection(input = {}) {
    const previousConnectionId = this.sshSessionService.getActiveConnectionId();
    const connection = this.registry.createConnection(input, {
      sshSessionService: this.sshSessionService,
    });
    this.clearCache();
    return {
      connection,
      previousConnectionId,
      switched: Boolean(previousConnectionId && previousConnectionId !== connection.connection_id),
    };
  }

  getActiveConnection() {
    const activeId = this.sshSessionService.getActiveConnectionId();
    if (!activeId) {
      return null;
    }
    const record = this.registry.getById(activeId);
    if (!record) {
      this.sshSessionService.disconnectAll();
      return null;
    }
    return sanitizeConnection(record, {
      sshAuthenticated: true,
      isActive: true,
    });
  }

  disconnectActiveConnection() {
    const activeId = this.sshSessionService.getActiveConnectionId();
    this.sshSessionService.disconnectAll();
    this.clearCache();
    return { disconnected: true, connection_id: activeId || null };
  }

  listConnections() {
    return this.registry.listConnections({ sshSessionService: this.sshSessionService });
  }

  async refreshConnectionHealth(connectionId) {
    const scope = this.resolveScope(connectionId);
    let status = 'connected';
    let detectorHealth = null;
    let vlmHealth = null;
    try {
      detectorHealth = await scope.detectorClient.getHealth();
    } catch (error) {
      status = 'error';
      detectorHealth = { status: 'unreachable', error: error.message };
    }
    try {
      vlmHealth = await scope.vlmClient.getHealth();
    } catch (error) {
      status = status === 'connected' ? 'disconnected' : 'error';
      vlmHealth = { status: 'unreachable', error: error.message };
    }

    if (detectorHealth?.status === 'ok' && vlmHealth?.status === 'ok') {
      status = 'connected';
    } else if (detectorHealth?.status === 'ok' || vlmHealth?.status === 'ok') {
      status = status === 'error' ? 'error' : 'disconnected';
    } else {
      status = 'disconnected';
    }

    this.registry.updateConnectionStatus(connectionId, status);
    this.clearCache(connectionId);
    return {
      status,
      detector: detectorHealth,
      vlm: vlmHealth,
    };
  }

  async getConnectionInfo(connectionId) {
    const scope = this.resolveScope(connectionId);
    const health = await this.refreshConnectionHealth(connectionId);
    let datasets = [];
    let detectorWeights = [];
    let vlmWeights = [];
    let jobs = [];
    let gpuInfo = null;

    if (health.detector?.status === 'ok') {
      try {
        const tree = await scope.detectorClient.getDataTree('', { maximumDepth: 2 });
        datasets = tree?.children || tree?.items || [];
      } catch (_error) {
        datasets = [];
      }
      try {
        const weights = await scope.detectorClient.listBaseWeights();
        detectorWeights = weights?.weights || [];
      } catch (_error) {
        detectorWeights = [];
      }
      try {
        const remoteJobs = await scope.detectorClient.listTrainingJobs();
        jobs = remoteJobs?.jobs || [];
      } catch (_error) {
        jobs = [];
      }
      gpuInfo = health.detector.gpu || health.detector.gpus || null;
    }

    if (health.vlm?.status === 'ok') {
      try {
        const weights = await scope.vlmClient.listBaseWeights();
        vlmWeights = weights?.weights || [];
      } catch (_error) {
        vlmWeights = [];
      }
    }

    return {
      connection: sanitizeConnection(scope.connection),
      health,
      datasetRoot: scope.runtimeConfig.paths.dataRoot,
      datasets,
      detectorWeights,
      vlmWeights,
      jobs,
      gpuInfo,
      agentVersion: {
        detector: health.detector?.service || health.detector?.version || null,
        vlm: health.vlm?.service || health.vlm?.version || null,
      },
    };
  }
}

module.exports = {
  TrainingConnectionHub,
};
