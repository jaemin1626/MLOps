'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJsonFile, writeJsonFileAtomic } = require('../utils/atomic-json-file');
const { spawnSafeProcess } = require('../utils/process-command-builder');
const { sendBuffer, streamFileAttachment } = require('../utils/http-api-helpers');
const { fetchRemoteWorkspaceFileViaHostSync } = require('../utils/remote-workspace-file-fetch');
const { sanitizeFileName } = require('../utils/path-security');
const { isRemoteMode } = require('./data-management-service');
const {
  assertRelativeTrainingPath,
  getTrainingWorkspaceRoot,
  resolveTrainingServerPath,
  toRelativeTrainingPath,
} = require('../utils/training-path-resolver');

function createExportId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `export_${timestamp}_${crypto.randomBytes(3).toString('hex')}`;
}

function splitEntryPoint(entryPoint) {
  const tokens = String(entryPoint || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error('ONNX Export Entry Point가 설정되지 않았습니다.');
  return { executable: tokens[0], baseArgs: tokens.slice(1) };
}

function requireValue(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${name} 항목은 필수입니다.`);
  }
  return value;
}

function quoteForPreview(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:=,-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function normalizeRelativeTrainingPath(inputPath, workspaceRoot) {
  const trimmed = String(inputPath || '').trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  const workspacePrefix = `${String(workspaceRoot).replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  if (trimmed.startsWith(workspacePrefix)) {
    return trimmed.slice(workspacePrefix.length);
  }
  return trimmed.replace(/^\/+/, '');
}

function extractRunFolderName(sourcePtPath, sourcePtRelativePath, runsRoot, workspaceRoot) {
  const runsPrefix = String(runsRoot || 'detector/runs')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const relative = normalizeRelativeTrainingPath(
    sourcePtRelativePath || sourcePtPath,
    workspaceRoot,
  );
  const prefix = `${runsPrefix}/`;
  if (!relative.startsWith(prefix)) return '';
  return relative.slice(prefix.length).split('/').filter(Boolean)[0] || '';
}

function normalizeImgSize(input) {
  const raw = String(input.imgSize || input.inputSize || '512,896').trim();
  if (raw.includes(',')) {
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2 || parts.some((part) => !Number(part) || Number(part) <= 0)) {
      throw new Error('img-size는 "512,896" 형식의 양의 정수 두 값이어야 합니다.');
    }
    return parts.join(',');
  }
  const size = Math.max(1, Number(raw));
  if (!Number.isFinite(size)) {
    throw new Error('img-size를 확인하세요.');
  }
  return String(size);
}

function normalizeThreshold(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} 값을 확인하세요.`);
  }
  return parsed;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(text)) {
    return false;
  }
  return fallback;
}

function formatExportCommandPreview(executable, args) {
  const scriptName = args[0];
  const optionArgs = args.slice(1);
  const lines = [`${quoteForPreview(executable)} ${quoteForPreview(scriptName)} \\`];
  let index = 0;
  while (index < optionArgs.length) {
    const flag = optionArgs[index];
    const next = optionArgs[index + 1];
    const isFlagOnly = next === undefined || String(next).startsWith('--');
    if (isFlagOnly) {
      const isLast = index >= optionArgs.length - 1;
      lines.push(`  ${quoteForPreview(flag)}${isLast ? '' : ' \\'}`);
      index += 1;
    } else {
      const isLast = index >= optionArgs.length - 2;
      lines.push(`  ${quoteForPreview(flag)} ${quoteForPreview(next)}${isLast ? '' : ' \\'}`);
      index += 2;
    }
  }
  return lines.join('\n');
}

function buildExportCommand(input, runtimeConfig) {
  const workspaceRoot = getTrainingWorkspaceRoot(runtimeConfig);
  const remoteExecution = isRemoteMode(runtimeConfig.export) || isRemoteMode(runtimeConfig.training);
  const rawSourcePtPath = String(requireValue(input.sourcePtPath, '.pt 모델 파일')).trim();

  let sourcePtRelativePath;
  let sourcePtPath;
  if (path.isAbsolute(rawSourcePtPath)) {
    sourcePtPath = path.resolve(rawSourcePtPath);
    sourcePtRelativePath = toRelativeTrainingPath(sourcePtPath, workspaceRoot) || rawSourcePtPath;
  } else {
    sourcePtRelativePath = assertRelativeTrainingPath(rawSourcePtPath, '.pt 모델 파일');
    sourcePtPath = resolveTrainingServerPath(sourcePtRelativePath, workspaceRoot, '.pt 모델 파일');
  }

  if (path.extname(sourcePtRelativePath).toLowerCase() !== '.pt') {
    throw new Error('.pt 모델 파일만 선택할 수 있습니다.');
  }
  if (!remoteExecution && !fs.existsSync(sourcePtPath)) {
    throw new Error(`원본 모델 파일이 존재하지 않습니다: ${sourcePtPath}`);
  }

  let outputDirectory;
  let outputRelativeDirectory;
  const rawOutput = String(
    input.outputDirectory || runtimeConfig.export?.outputRoot || 'detector/exports',
  ).trim();

  if (remoteExecution) {
    outputRelativeDirectory = path.isAbsolute(rawOutput)
      ? (toRelativeTrainingPath(rawOutput, workspaceRoot) || assertRelativeTrainingPath(rawOutput, '출력 경로'))
      : assertRelativeTrainingPath(rawOutput, '출력 경로');
    outputDirectory = resolveTrainingServerPath(outputRelativeDirectory, workspaceRoot, '출력 경로');
  } else {
    outputDirectory = path.resolve(requireValue(input.outputDirectory || runtimeConfig.paths.exportRoot, '출력 경로'));
    outputRelativeDirectory = rawOutput;
  }

  const outputFileName = sanitizeFileName(requireValue(input.outputFileName, 'ONNX 파일명'), '.onnx');
  const outputPath = path.posix.join(
    outputDirectory.replace(/\\/g, '/'),
    outputFileName,
  );
  const imgSize = normalizeImgSize(input);
  const batchSize = Math.max(1, Number(input.batchSize || 1));
  const opset = Math.max(7, Number(input.opset || 17));
  const maxDet = Math.max(1, Number(input.maxDet || 300));
  const confThres = normalizeThreshold(input.confThres, 0.25, 'conf-thres');
  const iouThres = normalizeThreshold(input.iouThres, 0.5, 'iou-thres');
  const end2end = normalizeBoolean(input.end2end ?? input.eNms, true);
  const dynamicBatch = normalizeBoolean(input.dynamicBatch, true);
  const simplify = normalizeBoolean(input.simplify, true);

  const entryPoint = splitEntryPoint(runtimeConfig.export.onnxEntryPoint);
  const args = [
    ...entryPoint.baseArgs,
    '--weights', sourcePtPath,
    '--output', outputPath,
    '--img-size', imgSize,
    '--batch-size', String(batchSize),
    '--opset', String(opset),
    '--max-det', String(maxDet),
    '--conf-thres', String(confThres),
    '--iou-thres', String(iouThres),
  ];
  if (end2end) args.push('--end2end');
  if (dynamicBatch) args.push('--dynamic-batch');
  if (simplify) args.push('--simplify');

  return {
    executable: entryPoint.executable,
    args,
    preview: formatExportCommandPreview(entryPoint.executable, args),
    normalizedParameters: {
      ...input,
      sourcePtPath,
      sourcePtRelativePath,
      outputDirectory,
      outputRelativeDirectory,
      outputFileName,
      outputPath,
      imgSize,
      batchSize,
      opset,
      maxDet,
      confThres,
      iouThres,
      end2end,
      dynamicBatch,
      simplify,
    },
  };
}

const REQUIRED_EXPORT_ONNX_VERSION = '4';

class OnnxExportService {
  constructor(runtimeConfig, modelCatalogService, trainingServerClient) {
    this.config = runtimeConfig;
    this.modelCatalogService = modelCatalogService;
    this.client = trainingServerClient;
    this.exportRoot = runtimeConfig.paths.exportRoot;
    this.workerPath = path.join(runtimeConfig.projectRoot, 'backup', 'dev', 'server-workers', 'onnx-export-process-simulator.js');
    this.liveProcesses = new Map();
    this.remoteSyncHandled = new Set();
    fs.mkdirSync(this.exportRoot, { recursive: true });
  }

  isRemoteExportMissing(error) {
    const message = String(error?.message || '');
    return message.includes('Export 작업을 찾을 수 없습니다')
      || message.includes('HTTP 404')
      || message.includes('404');
  }

  inferStatusFromLocalLog(directory) {
    const logPath = path.join(directory, 'export.log');
    if (!fs.existsSync(logPath)) return null;
    const log = fs.readFileSync(logPath, 'utf8');
    if (/\[export_onnx\] completed:/i.test(log) || /ONNX Export 완료/i.test(log)) {
      return 'completed';
    }
    if (/process exit code:\s*0\b/i.test(log)) {
      return 'completed';
    }
    if (/process exit code:\s*[1-9]\d*\b/i.test(log) || /\[export_onnx\] error:/i.test(log) || /ONNX Export 실패/i.test(log)) {
      return 'failed';
    }
    return null;
  }

  finalizeRemoteSync(exportId, payload) {
    if (this.remoteSyncHandled.has(exportId)) return null;
    this.remoteSyncHandled.add(exportId);
    return this.applyAgentCallback(exportId, payload);
  }

  usesRemoteApi() {
    return isRemoteMode(this.config.export) && this.client.isConfigured();
  }

  getRunsRoot() {
    return String(this.config.training?.runsRoot || 'detector/runs')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
  }

  resolveExportModelName(normalizedParameters, model = null) {
    const workspaceRoot = getTrainingWorkspaceRoot(this.config);
    const folderName = extractRunFolderName(
      normalizedParameters.sourcePtPath,
      normalizedParameters.sourcePtRelativePath,
      this.getRunsRoot(),
      workspaceRoot,
    );
    if (folderName) return folderName;
    return model?.modelName || path.parse(normalizedParameters.sourcePtPath).name;
  }

  enrichExportMetadata(metadata) {
    if (!metadata) return metadata;
    const parameters = metadata.parameters || {};
    return {
      ...metadata,
      modelName: this.resolveExportModelName({
        sourcePtPath: metadata.sourcePtPath || parameters.sourcePtPath,
        sourcePtRelativePath: parameters.sourcePtRelativePath || metadata.sourcePtRelativePath,
      }),
    };
  }

  isRemoteExportApiUnavailable(error) {
    const message = String(error?.message || '');
    return message.includes('404') || message.includes('JSON 응답을 해석하지 못했습니다');
  }

  isRemoteFileApiMissing(error) {
    const message = String(error?.message || '');
    return message.includes('HTTP 404') || message.includes('404');
  }

  async fetchRemoteExportFile(relativePath) {
    if (this.usesRemoteApi() && this.client.isConfigured() && !this.shouldSkipRemoteExportApi()) {
      try {
        return await this.client.getWorkspaceFile(relativePath);
      } catch (error) {
        if (!this.isRemoteFileApiMissing(error)) {
          throw error;
        }
      }
    }

    const fetched = await fetchRemoteWorkspaceFileViaHostSync(
      this.config.paths.dataRoot,
      relativePath,
    );
    return {
      buffer: fs.readFileSync(fetched.filePath),
      contentType: 'application/octet-stream',
      cacheFilePath: fetched.filePath,
    };
  }

  markRemoteExportApiUnavailable(error) {
    if (!this.remoteExportApiUnavailable) {
      console.warn('[OnnxExportService] 학습 서버 export API를 사용할 수 없어 로컬 처리로 전환합니다. agent 재빌드가 필요할 수 있습니다.');
      if (error?.message) {
        console.warn(`[OnnxExportService] 원격 export API 오류: ${error.message.split('\n')[0]}`);
      }
    }
    this.remoteExportApiUnavailable = true;
  }

  shouldSkipRemoteExportApi() {
    return Boolean(this.remoteExportApiUnavailable);
  }

  async assertRemoteExportScriptReady() {
    if (!this.client.isConfigured()) {
      return;
    }
    const health = await this.client.getHealth();
    const version = String(health?.exportOnnxVersion || '1');
    if (version !== REQUIRED_EXPORT_ONNX_VERSION) {
      const importError = String(health?.exportOnnxImportError || '').trim();
      const versionHint = version === '1'
        ? '버전 1은 agent Docker가 갱신되지 않았거나 export_onnx.py import가 실패한 상태입니다.'
        : `현재 agent export 스크립트 버전: ${version}`;
      const importHint = importError
        ? ` import 오류: ${importError}`
        : ' (health의 exportOnnxImportError 확인)';
      throw new Error(
        `학습 서버 export_onnx.py v${REQUIRED_EXPORT_ONNX_VERSION}가 준비되지 않았습니다. ${versionHint}${importHint} `
        + 'backup/docker/sync-training-agent.sh 로 agent 재빌드/재시작 후 '
        + 'curl http://172.16.8.60:9010/api/v1/health | grep exportOnnxVersion 으로 "4"를 확인하세요.',
      );
    }
  }

  async previewCommand(input) {
    if (this.usesRemoteApi() && !this.shouldSkipRemoteExportApi()) {
      try {
        const result = await this.client.previewExportCommand(input);
        return {
          preview: result.command,
          normalizedParameters: result.parameters,
          executable: null,
          args: [],
        };
      } catch (error) {
        if (this.isRemoteExportApiUnavailable(error)) {
          this.markRemoteExportApiUnavailable(error);
          return buildExportCommand(input, this.config);
        }
        throw error;
      }
    }
    return buildExportCommand(input, this.config);
  }

  async listExports() {
    await this.syncRunningExportsFromRemote();
    return this.listLocalExports();
  }

  async syncRunningExportsFromRemote() {
    const localExports = this.listLocalExports();
    const runningExports = localExports.filter((item) => item.status === 'running');
    if (!runningExports.length || !this.usesRemoteApi() || this.shouldSkipRemoteExportApi()) {
      return;
    }

    await Promise.all(runningExports.map(async (exportItem) => {
      if (this.remoteSyncHandled.has(exportItem.id)) {
        return;
      }

      const directory = exportItem.directory || path.join(this.exportRoot, exportItem.id);
      const inferredStatus = this.inferStatusFromLocalLog(directory);
      if (inferredStatus) {
        this.finalizeRemoteSync(exportItem.id, {
          status: inferredStatus,
          outputPath: exportItem.outputPath,
          errorMessage: inferredStatus === 'failed' ? 'Export 로그 기준 실패로 판정했습니다.' : null,
          exitCode: inferredStatus === 'completed' ? 0 : 1,
          completedAt: new Date().toISOString(),
          log: `[mlops-sync] inferred status=${inferredStatus} from export.log\n`,
        });
        return;
      }

      const processInfo = readJsonFile(path.join(directory, 'process.json'), {});
      const remoteId = processInfo.remoteJobId || exportItem.id;
      try {
        const remote = await this.client.getExport(remoteId);
        if (!remote || !['completed', 'failed'].includes(remote.status)) {
          return;
        }
        this.finalizeRemoteSync(exportItem.id, {
          status: remote.status,
          outputPath: remote.outputPath || exportItem.outputPath,
          errorMessage: remote.errorMessage,
          exitCode: remote.exitCode,
          completedAt: remote.finishedAt || remote.completedAt || new Date().toISOString(),
          log: `[agent-sync] remote status=${remote.status}\n`,
        });
      } catch (error) {
        if (this.isRemoteExportMissing(error)) {
          this.finalizeRemoteSync(exportItem.id, {
            status: 'failed',
            errorMessage: '학습 서버 agent에서 Export 작업을 찾을 수 없습니다. agent 재시작 또는 초기 실행 실패 가능성이 있습니다.',
            exitCode: 1,
            completedAt: new Date().toISOString(),
            log: `[mlops-sync] remote export not found: ${remoteId}\n`,
          });
          console.warn(`[OnnxExportService] stale running export marked failed: ${exportItem.id}`);
          return;
        }
        console.warn(`[OnnxExportService] 원격 Export 상태 동기화 실패 (${exportItem.id}): ${error.message}`);
      }
    }));
  }

  listLocalExports() {
    const exports = [];
    for (const entry of fs.readdirSync(this.exportRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.exportRoot, entry.name);
      const metadata = readJsonFile(path.join(directory, 'export.json'), null);
      if (metadata) {
        exports.push(this.enrichExportMetadata({
          ...metadata,
          directory,
          logPath: path.join(directory, 'export.log'),
        }));
      }
    }
    return exports.sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')));
  }

  async getExport(exportId) {
    const exports = await this.listExports();
    return exports.find((item) => item.id === exportId) || null;
  }

  async startExport(input) {
    if (this.usesRemoteApi()) {
      return this.startRemoteExport(input);
    }
    const command = buildExportCommand(input, this.config);
    const exportId = createExportId();
    const directory = path.join(this.exportRoot, exportId);
    fs.mkdirSync(directory, { recursive: true });
    if (!this.usesRemoteApi()) {
      fs.mkdirSync(command.normalizedParameters.outputDirectory, { recursive: true });
    }
    const model = await this.modelCatalogService.findModelByFilePath(command.normalizedParameters.sourcePtPath);
    const startedAt = new Date().toISOString();
    const metadata = {
      id: exportId,
      modelName: this.resolveExportModelName(command.normalizedParameters, model),
      modelType: model?.modelType || '검출기',
      modelVersion: input.modelVersion || 'v1.0.0',
      sourcePtPath: command.normalizedParameters.sourcePtPath,
      sourcePtFileName: path.basename(command.normalizedParameters.sourcePtPath),
      outputPath: command.normalizedParameters.outputPath,
      outputOnnxFileName: command.normalizedParameters.outputFileName,
      command: command.preview,
      parameters: command.normalizedParameters,
      status: 'running',
      startedAt,
      completedAt: null,
      errorMessage: null,
    };
    writeJsonFileAtomic(path.join(directory, 'export.json'), metadata);
    fs.writeFileSync(path.join(directory, 'command.txt'), `${command.preview}\n`, 'utf8');
    fs.writeFileSync(path.join(directory, 'export.log'), `[${new Date().toLocaleTimeString('ko-KR')}] ONNX Export 시작\n`, 'utf8');

    if (this.config.export.executionMode === 'remote' || this.config.export.executionMode === 'agent') {
      await this.startAgentExport(directory, metadata, command);
    } else {
      this.startSimulatorExport(directory, metadata, command);
    }
    return this.getExport(exportId) || metadata;
  }

  async startRemoteExport(input) {
    await this.assertRemoteExportScriptReady();
    const command = buildExportCommand(input, this.config);
    const exportId = createExportId();
    const directory = path.join(this.exportRoot, exportId);
    fs.mkdirSync(directory, { recursive: true });
    if (!this.usesRemoteApi()) {
      fs.mkdirSync(command.normalizedParameters.outputDirectory, { recursive: true });
    }
    const model = await this.modelCatalogService.findModelByFilePath(command.normalizedParameters.sourcePtPath);
    const startedAt = new Date().toISOString();
    const metadata = {
      id: exportId,
      modelName: this.resolveExportModelName(command.normalizedParameters, model),
      modelType: model?.modelType || '검출기',
      modelVersion: input.modelVersion || 'v1.0.0',
      sourcePtPath: command.normalizedParameters.sourcePtPath,
      sourcePtFileName: path.basename(command.normalizedParameters.sourcePtPath),
      outputPath: command.normalizedParameters.outputPath,
      outputOnnxFileName: command.normalizedParameters.outputFileName,
      command: command.preview,
      parameters: command.normalizedParameters,
      status: 'running',
      startedAt,
      completedAt: null,
      errorMessage: null,
      executionMode: 'remote',
    };
    writeJsonFileAtomic(path.join(directory, 'export.json'), metadata);
    fs.writeFileSync(path.join(directory, 'command.txt'), `${command.preview}\n`, 'utf8');
    fs.writeFileSync(path.join(directory, 'export.log'), `[${new Date().toLocaleTimeString('ko-KR')}] 원격 ONNX Export 시작\n`, 'utf8');
    await this.startAgentExport(directory, metadata, command);
    return this.getExport(exportId) || metadata;
  }

  async startAgentExport(directory, metadata, command) {
    const callbackUrl = this.client.buildCallbackUrl(`/api/model-management/exports/${metadata.id}/callback`);
    try {
      const result = await this.client.startExport({
        exportId: metadata.id,
        executable: command.executable,
        args: command.args,
        metadata,
        callbackUrl,
        parameters: command.normalizedParameters,
      });
      writeJsonFileAtomic(path.join(directory, 'process.json'), {
        remoteJobId: result.remoteJobId || result.id || metadata.id,
        pid: result.pid || null,
        callbackUrl,
      });
    } catch (error) {
      if (this.isRemoteExportApiUnavailable(error)) {
        this.markRemoteExportApiUnavailable(error);
        const message = '학습 서버 export API가 없습니다. training-server-docker에서 build-image.sh 후 restart-docker.sh를 실행하세요.';
        this.finalizeExport(directory, metadata, 1, message);
        throw new Error(message);
      }
      this.finalizeExport(directory, metadata, 1, error.message);
      throw error;
    }
  }

  startSimulatorExport(directory, metadata, command) {
    const child = spawnSafeProcess(process.execPath, [
      this.workerPath,
      '--source', command.normalizedParameters.sourcePtPath,
      '--output', command.normalizedParameters.outputPath,
      '--opset', String(command.normalizedParameters.opset),
    ], { cwd: this.config.projectRoot });
    this.liveProcesses.set(metadata.id, child);
    writeJsonFileAtomic(path.join(directory, 'process.json'), { pid: child.pid, startedAt: new Date().toISOString() });
    child.stdout.on('data', (chunk) => fs.appendFileSync(path.join(directory, 'export.log'), chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => fs.appendFileSync(path.join(directory, 'export.log'), `[stderr] ${chunk.toString('utf8')}`));
    child.on('error', (error) => this.finalizeExport(directory, metadata, 1, error.message));
    child.on('close', (exitCode) => {
      this.liveProcesses.delete(metadata.id);
      this.finalizeExport(directory, metadata, exitCode || 0, exitCode ? `프로세스 종료 코드: ${exitCode}` : null);
    });
  }

  finalizeExport(directory, metadata, exitCode, errorMessage) {
    if (!fs.existsSync(directory)) return;
    const completedAt = new Date().toISOString();
    const outputExists = fs.existsSync(metadata.outputPath);
    const completed = exitCode === 0 && outputExists;
    const finalMetadata = {
      ...metadata,
      status: completed ? 'completed' : 'failed',
      completedAt,
      exitCode,
      outputExists,
      outputSizeBytes: outputExists ? fs.statSync(metadata.outputPath).size : 0,
      errorMessage: completed ? null : (errorMessage || 'ONNX 파일이 생성되지 않았습니다.'),
    };
    writeJsonFileAtomic(path.join(directory, 'export.json'), finalMetadata);
    fs.appendFileSync(path.join(directory, 'export.log'), `[${new Date().toLocaleTimeString('ko-KR')}] ${completed ? 'ONNX Export 완료' : `ONNX Export 실패: ${finalMetadata.errorMessage}`}\n`);
  }


  applyAgentCallback(exportId, payload = {}) {
    const directory = path.join(this.exportRoot, exportId);
    const metadataPath = path.join(directory, 'export.json');
    const logPath = path.join(directory, 'export.log');
    if (!fs.existsSync(metadataPath)) {
      throw Object.assign(new Error('콜백 대상 Export 작업을 찾을 수 없습니다.'), { statusCode: 404 });
    }
    const metadata = readJsonFile(metadataPath, {});
    if (payload.log) {
      fs.appendFileSync(logPath, String(payload.log).endsWith('\n') ? String(payload.log) : `${payload.log}\n`, 'utf8');
    }
    const requestedStatus = payload.status || metadata.status || 'running';
    const outputPath = payload.outputPath || metadata.outputPath;
    if (!['completed', 'failed'].includes(requestedStatus)) {
      const updated = {
        ...metadata,
        ...payload,
        outputPath,
        status: requestedStatus,
        updatedAt: new Date().toISOString(),
      };
      delete updated.log;
      writeJsonFileAtomic(metadataPath, updated);
      return updated;
    }
    const remoteExport = metadata.executionMode === 'remote' || this.usesRemoteApi();
    const completed = requestedStatus === 'completed';
    const outputExists = remoteExport
      ? completed
      : Boolean(outputPath && fs.existsSync(outputPath));
    const succeeded = completed && (remoteExport || outputExists);
    const completedAt = payload.completedAt || new Date().toISOString();
    const updated = {
      ...metadata,
      ...payload,
      outputPath,
      status: succeeded ? 'completed' : 'failed',
      completedAt,
      outputExists: succeeded,
      outputSizeBytes: succeeded && outputPath && !remoteExport && fs.existsSync(outputPath)
        ? fs.statSync(outputPath).size
        : (payload.outputSizeBytes || metadata.outputSizeBytes || 0),
      exitCode: payload.exitCode ?? (succeeded ? 0 : 1),
      errorMessage: succeeded ? null : (payload.errorMessage || metadata.errorMessage || 'ONNX Export가 완료되지 않았습니다.'),
    };
    delete updated.log;
    writeJsonFileAtomic(metadataPath, updated);
    fs.appendFileSync(logPath, `[${new Date().toLocaleTimeString('ko-KR')}] ${succeeded ? 'ONNX Export 완료 콜백 수신' : `ONNX Export 실패 콜백 수신: ${updated.errorMessage}`}\n`, 'utf8');
    return updated;
  }

  getLogPath(exportId) {
    const directory = path.join(this.exportRoot, exportId);
    return fs.existsSync(directory) ? path.join(directory, 'export.log') : null;
  }

  resolveExportOutputRelativePath(exportItem) {
    const workspaceRoot = getTrainingWorkspaceRoot(this.config);
    const outputPath = String(exportItem.outputPath || exportItem.parameters?.outputPath || '').trim();
    if (outputPath) {
      const relative = toRelativeTrainingPath(outputPath, workspaceRoot);
      if (relative && !path.posix.isAbsolute(relative) && !/^[A-Za-z]:\//.test(relative)) {
        return relative.replace(/^\/+/, '');
      }
    }
    const outputDir = String(
      exportItem.parameters?.outputRelativeDirectory
      || exportItem.parameters?.outputDirectory
      || this.config.export?.outputRoot
      || 'detector/exports',
    ).replace(/\\/g, '/').replace(/^\/+/, '');
    const fileName = exportItem.outputOnnxFileName
      || exportItem.parameters?.outputFileName
      || 'model.onnx';
    return path.posix.join(outputDir, fileName);
  }

  async streamExportDownload(exportId, response) {
    const exportItem = await this.getExport(exportId);
    if (!exportItem) {
      throw Object.assign(new Error('Export 작업을 찾을 수 없습니다.'), { statusCode: 404 });
    }
    if (exportItem.status !== 'completed') {
      throw Object.assign(new Error('완료된 Export만 다운로드할 수 있습니다.'), { statusCode: 400 });
    }

    const fileName = sanitizeFileName(
      exportItem.outputOnnxFileName || path.basename(exportItem.outputPath || 'model.onnx'),
      '.onnx',
    );
    const localOutputPath = exportItem.outputPath && fs.existsSync(exportItem.outputPath)
      ? exportItem.outputPath
      : null;

    if (localOutputPath && fs.statSync(localOutputPath).isFile()) {
      streamFileAttachment(response, localOutputPath, { fileName });
      return;
    }

    const relativePath = this.resolveExportOutputRelativePath(exportItem);
    if (!relativePath) {
      throw Object.assign(new Error('ONNX 출력 경로를 확인할 수 없습니다.'), { statusCode: 404 });
    }

    if (this.usesRemoteApi() && this.client.isConfigured()) {
      try {
        const remoteFile = await this.fetchRemoteExportFile(relativePath);
        if (remoteFile.cacheFilePath) {
          streamFileAttachment(response, remoteFile.cacheFilePath, {
            fileName,
            deleteAfterSend: true,
          });
          return;
        }
        sendBuffer(response, remoteFile.buffer, {
          contentType: 'application/octet-stream',
          contentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
        });
        return;
      } catch (error) {
        throw Object.assign(
          new Error(`ONNX 파일 다운로드 실패: ${error.message}`),
          { statusCode: 502 },
        );
      }
    }

    throw Object.assign(
      new Error(`ONNX 파일을 찾을 수 없습니다: ${relativePath}`),
      { statusCode: 404 },
    );
  }
}

module.exports = {
  OnnxExportService,
  buildExportCommand,
};
