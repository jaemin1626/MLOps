'use strict';

const path = require('path');
const { ensureAllowedPath } = require('../utils/path-security');
const { readJsonBody, routeMatch, sendJson, streamFile, sendBuffer } = require('../utils/http-api-helpers');
const { streamTextFile } = require('../utils/sse-log-stream');
const { extractConnectionId, rejectRawTrainingUrl } = require('../utils/connection-request');
const { DashboardSummaryService } = require('../services/dashboard-summary-service');
const {
  resolveDefaultClassFolderPath,
  resolveDefaultDetectorImagesPath,
  resolveDefaultVlmImagesPath,
  resolveDefaultVlmJsonPath,
  resolveDefaultVlmLabelFilePath,
  suggestVlmTrainingDatasets,
} = require('../utils/dataset-layout');

function createApiRouter(context) {
  const {
    runtimeConfig,
    connectionHub,
    agentTaskService,
  } = context;

  function resolveScope(parsedUrl, body = null) {
    if (body) {
      rejectRawTrainingUrl(body);
    }
    return connectionHub.resolveScope(extractConnectionId(parsedUrl, body));
  }

  function resolveDataRootPath(requestedPath, scope) {
    const candidate = typeof requestedPath === 'string' && requestedPath.trim()
      ? requestedPath.trim()
      : scope.runtimeConfig.paths.dataRoot;
    return ensureAllowedPath(candidate, scope.allowedDataRoots);
  }

  function ensureScopePath(requestedPath, scope, options = {}) {
    return ensureAllowedPath(requestedPath, scope.allowedDataRoots, options);
  }

  return async function routeApi(request, response, parsedUrl) {
    const pathname = parsedUrl.pathname;
    const method = request.method || 'GET';

    if (method === 'GET' && pathname === '/api/health') {
      const health = { status: 'ok', timestamp: new Date().toISOString() };
      const active = connectionHub.getActiveConnection();
      health.activeConnection = active;
      if (active) {
        try {
          const scope = connectionHub.resolveScope(active.connection_id);
          if (scope.detectorClient.isConfigured()) {
            try {
              health.trainingServer = await scope.detectorClient.getHealth();
            } catch (error) {
              health.trainingServer = { status: 'unreachable', error: error.message };
            }
          }
          if (scope.vlmClient?.isConfigured()) {
            try {
              health.vlmTrainingServer = await scope.vlmClient.getHealth();
            } catch (error) {
              health.vlmTrainingServer = { status: 'unreachable', error: error.message };
            }
          }
        } catch (error) {
          health.scopeError = error.message;
        }
      }
      return sendJson(response, 200, health);
    }

    if (method === 'GET' && pathname === '/api/connections/active') {
      return sendJson(response, 200, {
        activeConnection: connectionHub.getActiveConnection(),
      });
    }

    if (method === 'POST' && pathname === '/api/connections/disconnect') {
      return sendJson(response, 200, connectionHub.disconnectActiveConnection());
    }

    const connectionDetailMatch = routeMatch(pathname, /^\/api\/connections\/([^/]+)$/);
    if (pathname === '/api/connections') {
      if (method === 'GET') {
        return sendJson(response, 200, { connections: connectionHub.listConnections() });
      }
      if (method === 'POST') {
        const body = await readJsonBody(request);
        rejectRawTrainingUrl(body);
        delete body.connection_id;
        const created = connectionHub.createConnection(body);
        return sendJson(response, 201, created);
      }
    }

    const connectionConnectMatch = routeMatch(pathname, /^\/api\/connections\/([^/]+)\/connect$/);
    if (method === 'POST' && connectionConnectMatch) {
      const connectionId = decodeURIComponent(connectionConnectMatch[0]);
      const body = await readJsonBody(request);
      delete body.connection_id;
      const connected = connectionHub.connectConnection(connectionId, body);
      return sendJson(response, 200, connected);
    }

    if (connectionDetailMatch) {
      const connectionId = decodeURIComponent(connectionDetailMatch[0]);
      if (method === 'GET') {
        const connection = connectionHub.registry.getById(connectionId);
        if (!connection) {
          return sendJson(response, 404, { error: '학습 서버 Connection을 찾을 수 없습니다.' });
        }
        return sendJson(response, 200, {
          connection: require('../services/training-connection-registry-service').sanitizeConnection(
            connection,
            { sshAuthenticated: Boolean(connectionHub.sshSessionService.getSession(connectionId)) },
          ),
        });
      }
      if (method === 'PUT') {
        const body = await readJsonBody(request);
        rejectRawTrainingUrl(body);
        delete body.connection_id;
        delete body.ssh_password;
        const updated = connectionHub.registry.updateConnection(connectionId, body, {
          sshSessionService: connectionHub.sshSessionService,
        });
        connectionHub.clearCache(connectionId);
        return sendJson(response, 200, { connection: updated });
      }
      if (method === 'DELETE') {
        connectionHub.registry.deleteConnection(connectionId, {
          sshSessionService: connectionHub.sshSessionService,
        });
        connectionHub.clearCache(connectionId);
        return sendJson(response, 200, { deleted: true });
      }
    }

    const connectionConfigMatch = routeMatch(pathname, /^\/api\/connections\/([^/]+)\/config$/);
    if (connectionConfigMatch) {
      const connectionId = decodeURIComponent(connectionConfigMatch[0]);
      if (method === 'POST') {
        const body = await readJsonBody(request);
        connectionHub.connectConnection(connectionId, body);
        const connection = connectionHub.registry.requireById(connectionId);
        const config = connectionHub.registry.buildDownloadConfig(
          connection,
          runtimeConfig.trainingServer.mlopsPublicBaseUrl,
        );
        response.setHeader('Content-Disposition', `attachment; filename="connection-${connectionId}.json"`);
        return sendJson(response, 200, config);
      }
      return sendJson(response, 405, { error: 'Connection JSON 다운로드는 POST + SSH 인증이 필요합니다.' });
    }

    const connectionInfoMatch = routeMatch(pathname, /^\/api\/connections\/([^/]+)\/info$/);
    if (method === 'GET' && connectionInfoMatch) {
      const connectionId = decodeURIComponent(connectionInfoMatch[0]);
      return sendJson(response, 200, await connectionHub.getConnectionInfo(connectionId));
    }

    const connectionRefreshMatch = routeMatch(pathname, /^\/api\/connections\/([^/]+)\/refresh-health$/);
    if (method === 'POST' && connectionRefreshMatch) {
      const connectionId = decodeURIComponent(connectionRefreshMatch[0]);
      const health = await connectionHub.refreshConnectionHealth(connectionId);
      return sendJson(response, 200, health);
    }

    if (method === 'GET' && pathname === '/api/client-config') {
      const active = connectionHub.getActiveConnection();
      const connections = connectionHub.listConnections();
      if (!active) {
        return sendJson(response, 200, {
          connectionId: null,
          activeConnection: null,
          connections,
          requiresConnection: true,
          dataRoot: runtimeConfig.paths.dataRoot,
          dataExecutionMode: runtimeConfig.data.executionMode,
          trainingExecutionMode: runtimeConfig.training.executionMode,
          modelsExecutionMode: runtimeConfig.models.executionMode,
          exportExecutionMode: runtimeConfig.export.executionMode,
        });
      }

      const scope = connectionHub.resolveScope(active.connection_id);
      const dataRoot = scope.runtimeConfig.paths.dataRoot;
      return sendJson(response, 200, {
        connectionId: active.connection_id,
        activeConnection: active,
        connections,
        requiresConnection: false,
        dataRoot,
        detectorImagesRoot: resolveDefaultDetectorImagesPath(dataRoot),
        classFolderRoot: resolveDefaultClassFolderPath(dataRoot),
        vlmImagesRoot: resolveDefaultVlmImagesPath(dataRoot),
        vlmLabelRoot: resolveDefaultVlmJsonPath(dataRoot),
        vlmLabelFile: resolveDefaultVlmLabelFilePath(dataRoot),
        ...(() => {
          const vlmSuggestions = suggestVlmTrainingDatasets(dataRoot);
          return {
            vlmTopics: vlmSuggestions.options,
            defaultVlmDatasetPath: vlmSuggestions.defaultDatasetPath,
            defaultVlmImagesDatasetPath: vlmSuggestions.defaultImagesDatasetPath,
          };
        })(),
        modelRoot: scope.runtimeConfig.paths.modelRoot,
        exportRoot: scope.runtimeConfig.paths.exportRoot,
        trainingServerBaseUrl: scope.runtimeConfig.trainingServer.baseUrl || null,
        vlmTrainingServerBaseUrl: scope.runtimeConfig.vlmTrainingServer?.baseUrl || null,
        dataExecutionMode: scope.runtimeConfig.data.executionMode,
        trainingExecutionMode: scope.runtimeConfig.training.executionMode,
        modelsExecutionMode: scope.runtimeConfig.models.executionMode,
        exportExecutionMode: scope.runtimeConfig.export.executionMode,
        trainingWorkspaceRoot: scope.runtimeConfig.training.workspaceRoot || null,
        trainingDatasetPath: scope.runtimeConfig.training.datasetPath || null,
        trainingRunsRoot: scope.runtimeConfig.training.runsRoot || null,
        exportOutputRoot: scope.runtimeConfig.export.outputRoot || 'detector/exports',
        trainingConfigsRoot: scope.runtimeConfig.training.configsRoot || null,
        trainingWeightsRoot: scope.runtimeConfig.training.weightsRoot || null,
      });
    }

    if (method === 'GET' && pathname === '/api/dashboard') {
      const active = connectionHub.getActiveConnection();
      if (!active) {
        return sendJson(response, 200, {
          requiresConnection: true,
          cards: {
            runningTraining: 0,
            completedTraining: 0,
            detectorDatasets: 0,
            vlmDatasets: 0,
            deployedModels: 0,
          },
          jobs: [],
          exports: [],
          distribution: { running: 0, completed: 0, failed: 0, waiting: 0, unknown: 0 },
          latestLog: '',
        });
      }
      const scope = connectionHub.resolveScope(active.connection_id);
      const dashboardSummaryService = new DashboardSummaryService(
        scope.runtimeConfig,
        scope.trainingJobService,
        scope.modelCatalogService,
        scope.onnxExportService,
      );
      return sendJson(response, 200, await dashboardSummaryService.getSummary());
    }

    if (method === 'POST' && pathname === '/api/data/sync') {
      const body = await readJsonBody(request).catch(() => ({}));
      const scope = resolveScope(parsedUrl, body);
      const result = await scope.datasetSyncService.requestSync({
        timeoutMs: body.timeoutMs || 120000,
      });
      return sendJson(response, 200, result);
    }

    if (method === 'GET' && pathname === '/api/data/sync-status') {
      const scope = resolveScope(parsedUrl);
      return sendJson(response, 200, scope.datasetSyncService.getStatus());
    }

    if (method === 'POST' && pathname === '/api/data/tree') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const rootPath = resolveDataRootPath(body.path, scope);
      return sendJson(response, 200, await scope.dataManagementService.getTree(rootPath, {
        maximumDepth: scope.runtimeConfig.scan.maximumTreeDepth,
      }));
    }

    if (method === 'POST' && pathname === '/api/data/summary') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      if (!body.path || !String(body.path).trim()) {
        return sendJson(response, 400, { error: '폴더 경로를 선택하세요.' });
      }
      const folderPath = ensureScopePath(body.path, scope);
      return sendJson(response, 200, await scope.dataManagementService.getSummary(folderPath, {
        maximumFiles: scope.runtimeConfig.scan.maximumFilesPerFolder,
        maximumImages: body.maximumImages || 100,
        recursive: Boolean(body.recursive),
      }));
    }

    if (method === 'POST' && pathname === '/api/data/event-folders') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const rootPath = resolveDataRootPath(body.path, scope);
      return sendJson(response, 200, await scope.dataManagementService.searchEventFolders(rootPath, {
        query: body.query || '',
        immediateOnly: body.immediateOnly !== false,
        maximumDepth: body.maximumDepth || scope.runtimeConfig.scan.maximumTreeDepth,
        maximumResults: body.maximumResults || 300,
      }));
    }

    if (method === 'GET' && pathname === '/api/data/image') {
      const scope = resolveScope(parsedUrl);
      const requestedPath = parsedUrl.searchParams.get('path');
      if (!requestedPath || !requestedPath.trim()) {
        return sendJson(response, 400, { error: '이미지 경로가 비어 있습니다.' });
      }
      const imagePath = ensureScopePath(requestedPath, scope);
      const remoteImage = await scope.dataManagementService.getImageBuffer(imagePath);
      if (remoteImage) {
        return sendBuffer(response, remoteImage.buffer, {
          contentType: remoteImage.contentType,
          cacheControl: 'private, max-age=60',
        });
      }
      return streamFile(response, imagePath, { cacheControl: 'private, max-age=60' });
    }

    if (method === 'GET' && pathname === '/api/tagging/images') {
      const scope = resolveScope(parsedUrl);
      const imageDirectory = ensureScopePath(parsedUrl.searchParams.get('imageDirectory'), scope);
      const labelDirectory = ensureScopePath(
        parsedUrl.searchParams.get('labelDirectory') || imageDirectory,
        scope,
        { mustExist: false },
      );
      return sendJson(response, 200, await scope.dataManagementService.listTaggingImages(imageDirectory, labelDirectory));
    }

    if (method === 'GET' && pathname === '/api/tagging/labels') {
      const scope = resolveScope(parsedUrl);
      const imagePath = ensureScopePath(parsedUrl.searchParams.get('imagePath'), scope);
      const imageDirectory = ensureScopePath(
        parsedUrl.searchParams.get('imageDirectory') || path.dirname(imagePath),
        scope,
      );
      const labelDirectory = ensureScopePath(
        parsedUrl.searchParams.get('labelDirectory') || path.join(imageDirectory, 'labels'),
        scope,
        { mustExist: false },
      );
      const saveBesideImage = parsedUrl.searchParams.get('saveBesideImage') === '1';
      return sendJson(response, 200, await scope.dataManagementService.getLabels(
        imagePath,
        imageDirectory,
        labelDirectory,
        { saveBesideImage },
      ));
    }

    if (method === 'POST' && pathname === '/api/tagging/labels') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const imagePath = ensureScopePath(body.imagePath, scope);
      const imageDirectory = ensureScopePath(
        body.imageDirectory || path.dirname(imagePath),
        scope,
      );
      const labelDirectory = ensureScopePath(
        body.labelDirectory || path.join(imageDirectory, 'labels'),
        scope,
        { mustExist: false },
      );
      return sendJson(response, 200, await scope.dataManagementService.saveLabels(
        imagePath,
        imageDirectory,
        labelDirectory,
        body.labels || [],
        { saveBesideImage: Boolean(body.saveBesideImage) },
      ));
    }

    if (method === 'GET' && pathname === '/api/tagging/folders') {
      const scope = resolveScope(parsedUrl);
      const directoryPath = ensureScopePath(
        resolveDataRootPath(parsedUrl.searchParams.get('directory') || scope.runtimeConfig.paths.dataRoot, scope),
        scope,
      );
      return sendJson(response, 200, await scope.dataManagementService.browseTaggingFolders(directoryPath));
    }

    if (method === 'GET' && pathname === '/api/tagging/class-files') {
      const scope = resolveScope(parsedUrl);
      const directoryPath = ensureScopePath(
        resolveDataRootPath(parsedUrl.searchParams.get('directory') || scope.runtimeConfig.paths.dataRoot, scope),
        scope,
      );
      return sendJson(response, 200, await scope.dataManagementService.browseClassDefinitionFiles(directoryPath));
    }

    if (method === 'POST' && pathname === '/api/tagging/classes-file') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const filePath = ensureScopePath(body.path, scope);
      if (!filePath.toLowerCase().endsWith('.txt')) {
        return sendJson(response, 400, { error: 'txt 파일만 선택할 수 있습니다.' });
      }
      return sendJson(response, 200, await scope.dataManagementService.loadClassDefinitionFile(filePath));
    }

    if (method === 'POST' && pathname === '/api/tagging/classes-text') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const text = String(body.text || '');
      if (!text.trim()) {
        return sendJson(response, 400, { error: '클래스 txt 내용이 비어 있습니다.' });
      }
      return sendJson(response, 200, await scope.dataManagementService.loadClassDefinitionFromText(
        text,
        body.fileName || 'classes.txt',
      ));
    }

    if (method === 'GET' && pathname === '/api/tagging/base-weights') {
      const scope = resolveScope(parsedUrl);
      if (scope.detectorClient.isConfigured()) {
        try {
          return sendJson(response, 200, await scope.detectorClient.listBaseWeights());
        } catch (error) {
          console.warn(`[mlops-api] agent base weights 조회 실패, local index fallback: ${error.message}`);
        }
      }
      const local = await scope.detectorWeightsService.listWeights({ refresh: true });
      return sendJson(response, 200, {
        weightsRoot: local.weightsRoot,
        weightsAbsolutePath: local.weightsRoot,
        weights: local.weights,
        source: 'local-index',
      });
    }

    if (method === 'POST' && pathname === '/api/tagging/pseudo-label') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const imageDirectory = ensureScopePath(
        body.imageDirectory || resolveDataRootPath(body.imageDirectory, scope),
        scope,
      );
      const imagePath = body.imagePath
        ? ensureScopePath(body.imagePath, scope)
        : undefined;
      const imagePaths = Array.isArray(body.imagePaths)
        ? body.imagePaths.map((item) => ensureScopePath(item, scope))
        : undefined;
      return sendJson(response, 200, await scope.pseudoLabelService.runPseudoLabel({
        ...body,
        imageDirectory,
        imagePath,
        imagePaths,
        classNames: Array.isArray(body.classNames) ? body.classNames : undefined,
      }));
    }

    if (method === 'GET' && pathname === '/api/vlm-tagging/images') {
      const scope = resolveScope(parsedUrl);
      const imageDirectory = ensureScopePath(
        parsedUrl.searchParams.get('imageDirectory')
          || resolveDefaultVlmImagesPath(scope.runtimeConfig.paths.dataRoot),
        scope,
      );
      return sendJson(response, 200, await scope.dataManagementService.listVlmTaggingImages(imageDirectory));
    }

    if (method === 'GET' && pathname === '/api/vlm-tagging/record') {
      const scope = resolveScope(parsedUrl);
      const imagePath = ensureScopePath(parsedUrl.searchParams.get('imagePath'), scope);
      const imageDirectory = ensureScopePath(
        parsedUrl.searchParams.get('imageDirectory')
          || resolveDefaultVlmImagesPath(scope.runtimeConfig.paths.dataRoot),
        scope,
      );
      const humanPrompt = parsedUrl.searchParams.get('humanPrompt') || '';
      return sendJson(response, 200, await scope.dataManagementService.getVlmRecord(
        imagePath,
        imageDirectory,
        { humanPrompt },
      ));
    }

    if (method === 'POST' && pathname === '/api/vlm-tagging/record') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const imagePath = ensureScopePath(body.imagePath, scope);
      const imageDirectory = ensureScopePath(
        body.imageDirectory || resolveDefaultVlmImagesPath(scope.runtimeConfig.paths.dataRoot),
        scope,
      );
      return sendJson(response, 200, await scope.dataManagementService.saveVlmRecord(
        imagePath,
        imageDirectory,
        body.record || {},
        { humanPrompt: body.humanPrompt || '' },
      ));
    }

    if (method === 'GET' && pathname === '/api/vlm-tagging/folders') {
      const scope = resolveScope(parsedUrl);
      const directoryPath = ensureScopePath(
        resolveDataRootPath(parsedUrl.searchParams.get('directory') || scope.runtimeConfig.paths.dataRoot, scope),
        scope,
      );
      return sendJson(response, 200, await scope.dataManagementService.browseTaggingFolders(directoryPath));
    }

    if (method === 'GET' && pathname === '/api/training/vlm-dataset-suggestions') {
      const scope = resolveScope(parsedUrl);
      const dataRoot = ensureScopePath(scope.runtimeConfig.paths.dataRoot, scope);
      const refresh = parsedUrl.searchParams.get('refresh') === '1';
      return sendJson(response, 200, suggestVlmTrainingDatasets(dataRoot, { refresh }));
    }

    if (method === 'GET' && pathname === '/api/training/dataset-suggestions') {
      const scope = resolveScope(parsedUrl);
      const datasetPath = parsedUrl.searchParams.get('datasetPath') || '';
      const modelName = parsedUrl.searchParams.get('modelName') || '';
      const refresh = parsedUrl.searchParams.get('refresh') === '1';
      if (datasetPath || modelName) {
        const resolvedDatasetPath = datasetPath
          || scope.runtimeConfig.training?.datasetPath
          || 'dataset/Images/Integrated';
        const resolvedModelName = modelName
          || scope.runtimeConfig.training?.defaultSplitModelName
          || 'Detector_YOLO_Training';
        const split = scope.datasetConfigService.suggestSplitPaths(resolvedDatasetPath, resolvedModelName);
        return sendJson(response, 200, {
          datasetPath: resolvedDatasetPath,
          trainPath: split.trainPath,
          valPath: split.valPath,
          modelFolderName: split.modelFolderName,
          splitSummary: split.exists
            ? `기존 split 사용 (train ${split.trainCount}, valid ${split.valCount})`
            : 'split 없음 · 9:1 Split 생성 시 detector/data/{학습명}/train.txt · valid.txt 가 생성됩니다.',
        });
      }
      return sendJson(response, 200, scope.datasetConfigService.suggestDatasetPath({ refresh }));
    }

    if (method === 'GET' && pathname === '/api/training/class-definition-files') {
      const scope = resolveScope(parsedUrl);
      const datasetPath = parsedUrl.searchParams.get('datasetPath') || '';
      return sendJson(response, 200, scope.datasetConfigService.listClassDefinitionFiles({ datasetPath }));
    }

    if (method === 'POST' && pathname === '/api/training/dataset-config-preview') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      return sendJson(response, 200, scope.datasetConfigService.buildPreview(body));
    }

    if (method === 'POST' && pathname === '/api/training/dataset-split') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const remoteMode = scope.runtimeConfig.training?.executionMode === 'remote'
        || scope.runtimeConfig.training?.executionMode === 'agent';
      const task = agentTaskService.createTask('dataset.split', {
        request: body,
        connectionId: scope.connection.connection_id,
      });
      agentTaskService.appendLog(task.id, '[START] 9:1 split 생성 요청');
      agentTaskService.appendLog(task.id, `[INFO] 학습명: ${body.name || '(미지정)'}`);
      agentTaskService.appendLog(task.id, `[INFO] 데이터셋: ${
        (Array.isArray(body.datasetPaths) && body.datasetPaths.length
          ? body.datasetPaths.join(', ')
          : body.datasetPath) || '(미지정)'
      }`);

      if (remoteMode && scope.detectorClient.isConfigured()) {
        agentTaskService.appendLog(task.id, '[STEP] 학습 서버 agent에 명령 전송...');
        const callbackUrl = scope.detectorClient.buildCallbackUrl(`/api/training/agent-tasks/${task.id}/callback`);
        try {
          const accepted = await scope.detectorClient.submitCommand({
            taskId: task.id,
            commandType: 'dataset.split',
            payload: body,
            callbackUrl,
          });
          agentTaskService.updateTask(task.id, {
            status: accepted.status || 'queued',
            remoteTaskId: accepted.taskId || task.id,
            pollUrl: `/api/training/agent-tasks/${task.id}`,
          });
          agentTaskService.appendLog(task.id, `[ OK ] agent 접수 · taskId=${accepted.taskId || task.id}`);
          return sendJson(response, 202, agentTaskService.getTask(task.id));
        } catch (error) {
          agentTaskService.appendLog(task.id, `[ERR ] agent 명령 전송 실패: ${error.message}`);
          agentTaskService.appendLog(task.id, '[INFO] 학습 서버 docker 재빌드 후 /api/v1/commands API를 사용하세요.');
          agentTaskService.updateTask(task.id, {
            status: 'failed',
            errorMessage: error.message,
            pollUrl: `/api/training/agent-tasks/${task.id}`,
          });
          return sendJson(response, 202, agentTaskService.getTask(task.id));
        }
      }

      agentTaskService.appendLog(task.id, '[STEP] 로컬 split 생성 중...');
      agentTaskService.updateTask(task.id, { status: 'running', pollUrl: `/api/training/agent-tasks/${task.id}` });
      setImmediate(() => {
        try {
          const result = scope.datasetConfigService.createDatasetSplit(body);
          (result.logs || []).forEach((line) => agentTaskService.appendLog(task.id, line));
          agentTaskService.applyCallback(task.id, {
            status: 'completed',
            result: { ...result, remoteApplied: false },
          });
        } catch (error) {
          (error.logs || []).forEach((line) => agentTaskService.appendLog(task.id, line));
          agentTaskService.applyCallback(task.id, {
            status: 'failed',
            errorMessage: error.message,
          });
        }
      });
      return sendJson(response, 202, agentTaskService.getTask(task.id));
    }

    const agentTaskMatch = routeMatch(pathname, /^\/api\/training\/agent-tasks\/([^/]+)$/);
    if (method === 'GET' && agentTaskMatch) {
      const scope = resolveScope(parsedUrl);
      const taskId = agentTaskMatch[0];
      const task = agentTaskService.getTask(taskId);
      if (!task) {
        return sendJson(response, 404, { error: 'agent task를 찾을 수 없습니다.' });
      }
      if (task.connectionId && task.connectionId !== scope.connection.connection_id) {
        return sendJson(response, 404, { error: 'agent task를 찾을 수 없습니다.' });
      }
      if (task.remoteTaskId && ['accepted', 'queued', 'running'].includes(task.status)
        && scope.detectorClient.isConfigured()) {
        try {
          const remoteTask = await scope.detectorClient.getCommandTask(task.remoteTaskId);
          agentTaskService.applyCallback(taskId, remoteTask);
        } catch (_error) {
          // keep local task state
        }
      }
      return sendJson(response, 200, agentTaskService.getTask(taskId));
    }

    const agentTaskCallbackMatch = routeMatch(pathname, /^\/api\/training\/agent-tasks\/([^/]+)\/callback$/);
    if (method === 'POST' && agentTaskCallbackMatch) {
      const taskId = agentTaskCallbackMatch[0];
      const payload = await readJsonBody(request);
      const task = agentTaskService.applyCallback(taskId, payload);
      if (!task) {
        return sendJson(response, 404, { error: 'agent task를 찾을 수 없습니다.' });
      }
      return sendJson(response, 200, task);
    }

    if (method === 'GET' && pathname === '/api/training/weights') {
      const scope = resolveScope(parsedUrl);
      const refresh = parsedUrl.searchParams.get('refresh') === '1';
      const result = await scope.detectorWeightsService.listWeights({ refresh });
      return sendJson(response, 200, result);
    }

    if (method === 'GET' && pathname === '/api/training/jobs') {
      const scope = resolveScope(parsedUrl);
      return sendJson(response, 200, { jobs: await scope.trainingJobService.listJobs() });
    }

    const jobDetailMatch = routeMatch(pathname, /^\/api\/training\/jobs\/([^/]+)$/);
    if (method === 'GET' && jobDetailMatch) {
      const scope = resolveScope(parsedUrl);
      const job = await scope.trainingJobService.getJob(jobDetailMatch[0], {
        connectionId: scope.connection.connection_id,
      });
      return job ? sendJson(response, 200, job) : sendJson(response, 404, { error: '학습 작업을 찾을 수 없습니다.' });
    }

    if (method === 'POST' && pathname === '/api/training/command-preview') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const result = await scope.trainingJobService.previewCommand(body);
      return sendJson(response, 200, { command: result.preview, parameters: result.normalizedParameters });
    }

    if (method === 'POST' && pathname === '/api/training/jobs') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const job = await scope.trainingJobService.startJob(body);
      return sendJson(response, 201, job);
    }

    const trainingStopMatch = routeMatch(pathname, /^\/api\/training\/jobs\/([^/]+)\/stop$/);
    if (method === 'POST' && trainingStopMatch) {
      const scope = resolveScope(parsedUrl);
      const job = await scope.trainingJobService.stopJob(trainingStopMatch[0]);
      return sendJson(response, 200, { job });
    }

    const trainingCallbackMatch = routeMatch(pathname, /^\/api\/training\/jobs\/([^/]+)\/callback$/);
    if (method === 'POST' && trainingCallbackMatch) {
      const scope = resolveScope(parsedUrl);
      const result = scope.trainingJobService.applyAgentCallback(
        trainingCallbackMatch[0],
        await readJsonBody(request),
      );
      return sendJson(response, 200, result);
    }

    const trainingLogMatch = routeMatch(pathname, /^\/api\/training\/jobs\/([^/]+)\/log-stream$/);
    if (method === 'GET' && trainingLogMatch) {
      const scope = resolveScope(parsedUrl);
      const logPath = scope.trainingJobService.getLogPath(trainingLogMatch[0]);
      if (!logPath) return sendJson(response, 404, { error: '학습 로그를 찾을 수 없습니다.' });
      streamTextFile(response, logPath);
      return true;
    }

    if (method === 'GET' && pathname === '/api/model-management/models') {
      const scope = resolveScope(parsedUrl);
      return sendJson(response, 200, {
        models: await scope.modelCatalogService.listModels({ verifyArtifacts: false }),
      });
    }

    const modelDetailMatch = routeMatch(pathname, /^\/api\/model-management\/models\/([^/]+)$/);
    if (method === 'GET' && modelDetailMatch) {
      const scope = resolveScope(parsedUrl);
      const model = await scope.modelCatalogService.getModel(decodeURIComponent(modelDetailMatch[0]));
      if (!model) {
        return sendJson(response, 404, { error: '모델을 찾을 수 없습니다.' });
      }
      return sendJson(response, 200, { model });
    }

    if (method === 'GET' && pathname === '/api/model-management/runs/folders') {
      const scope = resolveScope(parsedUrl);
      return sendJson(response, 200, await scope.trainingRunsService.listRunFolders());
    }

    const runPtFilesMatch = routeMatch(pathname, /^\/api\/model-management\/runs\/([^/]+)\/pt-files$/);
    if (method === 'GET' && runPtFilesMatch) {
      const scope = resolveScope(parsedUrl);
      return sendJson(response, 200, await scope.trainingRunsService.listPtFiles(decodeURIComponent(runPtFilesMatch[0])));
    }

    if (method === 'GET' && pathname === '/api/model-management/exports') {
      const scope = resolveScope(parsedUrl);
      return sendJson(response, 200, { exports: await scope.onnxExportService.listExports() });
    }

    if (method === 'POST' && pathname === '/api/model-management/exports/command-preview') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const result = await scope.onnxExportService.previewCommand(body);
      return sendJson(response, 200, { command: result.preview, parameters: result.normalizedParameters });
    }

    if (method === 'POST' && pathname === '/api/model-management/exports') {
      const body = await readJsonBody(request);
      const scope = resolveScope(parsedUrl, body);
      const exportJob = await scope.onnxExportService.startExport(body);
      return sendJson(response, 201, exportJob);
    }

    const exportCallbackMatch = routeMatch(pathname, /^\/api\/model-management\/exports\/([^/]+)\/callback$/);
    if (method === 'POST' && exportCallbackMatch) {
      const scope = resolveScope(parsedUrl);
      const result = scope.onnxExportService.applyAgentCallback(
        exportCallbackMatch[0],
        await readJsonBody(request),
      );
      return sendJson(response, 200, result);
    }

    const exportLogMatch = routeMatch(pathname, /^\/api\/model-management\/exports\/([^/]+)\/log-stream$/);
    if (method === 'GET' && exportLogMatch) {
      const scope = resolveScope(parsedUrl);
      const logPath = scope.onnxExportService.getLogPath(exportLogMatch[0]);
      if (!logPath) return sendJson(response, 404, { error: 'Export 로그를 찾을 수 없습니다.' });
      streamTextFile(response, logPath, { intervalMs: 250 });
      return true;
    }

    const exportDownloadMatch = routeMatch(pathname, /^\/api\/model-management\/exports\/([^/]+)\/download$/);
    if (method === 'GET' && exportDownloadMatch) {
      const scope = resolveScope(parsedUrl);
      try {
        await scope.onnxExportService.streamExportDownload(exportDownloadMatch[0], response);
        return true;
      } catch (error) {
        return sendJson(response, error.statusCode || 500, { error: error.message });
      }
    }

    return sendJson(response, 404, { error: 'API Endpoint를 찾을 수 없습니다.' });
  };
}

module.exports = { createApiRouter };
