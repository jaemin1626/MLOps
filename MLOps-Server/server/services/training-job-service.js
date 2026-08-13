'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJsonFile, writeJsonFileAtomic } = require('../utils/atomic-json-file');
const { commandPreview, spawnSafeProcess } = require('../utils/process-command-builder');
const { isRemoteMode } = require('./data-management-service');
const {
  assertRelativeTrainingPath,
  getTrainingWorkspaceRoot,
  resolveTrainingServerPath,
  toRelativeTrainingPath,
} = require('../utils/training-path-resolver');
const { DatasetConfigService, normalizeDatasetPaths } = require('./dataset-config-service');

const STATUS_FOLDERS = ['running', 'completed', 'failed'];

function createJobId(prefix = 'train') {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${prefix}_${timestamp}_${crypto.randomBytes(3).toString('hex')}`;
}

function splitEntryPoint(entryPoint) {
  const tokens = String(entryPoint || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    throw new Error('학습 실행 Entry Point가 설정되지 않았습니다.');
  }
  return { executable: tokens[0], baseArgs: tokens.slice(1) };
}

function required(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${fieldName} 항목은 필수입니다.`);
  }
  return value;
}

function positiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} 항목은 0보다 큰 숫자여야 합니다.`);
  }
  return number;
}

function buildTrainingCommand(input, runtimeConfig) {
  const trainingType = required(input.trainingType, '학습 유형');
  const workspaceRoot = getTrainingWorkspaceRoot(runtimeConfig);
  const datasetPaths = normalizeDatasetPaths(input);
  if (!datasetPaths.length) {
    throw new Error('학습 데이터셋 경로를 하나 이상 선택하세요.');
  }
  const datasetPath = datasetPaths.join(',');
  const common = {
    name: required(input.name, '학습명'),
    trainingType,
    datasetPath,
    datasetPaths,
    outputPath: assertRelativeTrainingPath(input.outputPath, '학습 결과 저장 경로'),
    gpu: String(input.gpu ?? '0'),
    epochs: positiveNumber(input.epochs, 'Epoch'),
    batchSize: positiveNumber(input.batchSize, 'Batch Size'),
    learningRate: positiveNumber(input.learningRate, 'Learning Rate'),
  };
  const resolvedDatasetPath = datasetPaths
    .map((item) => resolveTrainingServerPath(item, workspaceRoot, '학습 데이터셋 경로'))
    .join(',');
  const resolvedOutputPath = resolveTrainingServerPath(common.outputPath, workspaceRoot, '학습 결과 저장 경로');

  const entryPoint = splitEntryPoint(
    trainingType === 'detector'
      ? runtimeConfig.training.detectorEntryPoint
      : runtimeConfig.training.vlmEntryPoint,
  );

  const args = [
    ...entryPoint.baseArgs,
    '--name', common.name,
    '--dataset', resolvedDatasetPath,
    '--output-dir', resolvedOutputPath,
    '--device', common.gpu,
    '--epochs', String(common.epochs),
    '--batch-size', String(common.batchSize),
    '--learning-rate', String(common.learningRate),
  ];

  if (trainingType === 'detector') {
    const modelPath = assertRelativeTrainingPath(input.modelPath, 'Pretrained Weights');
    required(modelPath, 'Pretrained Weights');
    args.push('--model', resolveTrainingServerPath(modelPath, workspaceRoot, 'Pretrained Weights'));
    if (input.datasetConfigPath) {
      const datasetConfigPath = assertRelativeTrainingPath(input.datasetConfigPath, '데이터셋 설정 파일');
      args.push('--data-config', resolveTrainingServerPath(datasetConfigPath, workspaceRoot, '데이터셋 설정 파일'));
    }
    args.push('--img-size', String(positiveNumber(input.imageSize || 640, '이미지 크기')));
    args.push('--optimizer', String(input.optimizer || 'AdamW'));
    args.push('--workers', String(Math.max(0, Number(input.workers || 0))));
    if (input.pretrained) args.push('--pretrained');
    if (input.resume) {
      args.push('--resume');
      if (input.resumeCheckpoint) {
        const resumeCheckpoint = assertRelativeTrainingPath(input.resumeCheckpoint, 'Resume 체크포인트 경로');
        args.push('--resume-checkpoint', resolveTrainingServerPath(resumeCheckpoint, workspaceRoot, 'Resume 체크포인트 경로'));
      }
    }
  } else if (trainingType === 'vlm') {
    required(input.baseModel, 'Base Model');
    args.push('--base-model', input.baseModel);
    args.push('--gradient-accumulation-steps', String(positiveNumber(input.gradientAccumulationSteps || 1, 'Gradient Accumulation Steps')));
    args.push('--max-sequence-length', String(positiveNumber(input.maxSequenceLength || 2048, 'Max Sequence Length')));
    args.push('--optimizer', String(input.optimizer || 'AdamW'));
    args.push('--precision', String(input.precision || 'bf16'));
    if (input.useLora) {
      args.push('--use-lora');
      args.push('--lora-rank', String(positiveNumber(input.loraRank || 8, 'LoRA Rank')));
      args.push('--lora-alpha', String(positiveNumber(input.loraAlpha || 16, 'LoRA Alpha')));
      args.push('--lora-dropout', String(Math.max(0, Number(input.loraDropout || 0))));
    }
    if (input.resume) {
      args.push('--resume');
      if (input.resumeCheckpoint) {
        const resumeCheckpoint = assertRelativeTrainingPath(input.resumeCheckpoint, 'Resume 체크포인트 경로');
        args.push('--resume-checkpoint', resolveTrainingServerPath(resumeCheckpoint, workspaceRoot, 'Resume 체크포인트 경로'));
      }
    }
  } else {
    throw new Error('지원하지 않는 학습 유형입니다.');
  }

  return {
    executable: entryPoint.executable,
    args,
    preview: commandPreview(entryPoint.executable, args),
    normalizedParameters: { ...input, ...common },
  };
}

function flattenRemoteTrainingJob(job) {
  const progress = job.progress && typeof job.progress === 'object' ? job.progress : {};
  return {
    ...job,
    ...progress,
    status: progress.status || job.status,
  };
}

function isRemoteExecutionJob(metadata = {}) {
  return ['remote', 'agent'].includes(String(metadata.executionMode || ''));
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function parseTrainingProgressFromLogLine(line) {
  const cleaned = stripAnsi(line).trim();
  if (!cleaned) return null;

  const mlopsMatch = cleaned.match(
    /MLOPS_PROGRESS\s+epoch=(\d+)\/(\d+)\s+step=(\d+)\/(\d+)\s+loss=([\d.]+)(?:\s+progress=([\d.]+))?/,
  );
  if (mlopsMatch) {
    const epoch = Number(mlopsMatch[1]);
    const totalEpoch = Number(mlopsMatch[2]);
    const step = Number(mlopsMatch[3]);
    const totalStep = Number(mlopsMatch[4]);
    const loss = Number(mlopsMatch[5]);
    const progress = mlopsMatch[6]
      ? Number(mlopsMatch[6])
      : Math.min(100, Math.round(((epoch - 1 + (step / Math.max(totalStep, 1))) / Math.max(totalEpoch, 1)) * 10000) / 100);
    return { epoch, totalEpoch, step, totalStep, loss, progress };
  }

  const startingVlm = cleaned.match(/Starting VLM training for (\d+) epochs?/i);
  if (startingVlm) {
    return { totalEpoch: Number(startingVlm[1]) };
  }

  const starting = cleaned.match(/Starting training for (\d+) epochs?/i);
  if (starting) {
    return { totalEpoch: Number(starting[1]) };
  }

  const epochMatch = cleaned.match(/^(\d+)\/(\d+)\s+\S+\s+([\d.]+)/);
  if (!epochMatch) return null;

  const epoch = Number(epochMatch[1]);
  const totalEpoch = Number(epochMatch[2]);
  const loss = Number(epochMatch[3]);
  let step = 0;
  let totalStep = 0;
  const batchMatch = cleaned.match(/:\s*\d+%[^0-9/]*(\d+)\/(\d+)\s+\d/);
  if (batchMatch) {
    step = Number(batchMatch[1]);
    totalStep = Number(batchMatch[2]);
  }

  const progress = totalStep > 0
    ? Math.min(100, Math.round(((epoch - 1 + (step / totalStep)) / Math.max(totalEpoch, 1)) * 10000) / 100)
    : Math.min(100, Math.round((epoch / Math.max(totalEpoch, 1)) * 10000) / 100);

  return {
    epoch,
    totalEpoch,
    step,
    totalStep,
    loss,
    progress,
  };
}

function enrichProgressFromLogTail(jobDirectory, progress, metadata = {}) {
  const logPath = path.join(jobDirectory, 'train.log');
  if (!fs.existsSync(logPath)) return progress;

  const merged = { ...progress };
  const tail = fs.readFileSync(logPath, 'utf8').slice(-200000);
  for (const line of tail.split(/\r?\n/)) {
    const parsed = parseTrainingProgressFromLogLine(line);
    if (parsed) Object.assign(merged, parsed);
  }

  if ((merged.status === 'running' || !merged.status) && metadata.startedAt) {
    merged.elapsedSeconds = Math.floor((Date.now() - new Date(metadata.startedAt).getTime()) / 1000);
  }
  return merged;
}

function processExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

class TrainingJobService {
  constructor(runtimeConfig, detectorClient, vlmClient = null) {
    this.config = runtimeConfig;
    this.detectorClient = detectorClient;
    this.vlmClient = vlmClient || detectorClient;
    this.jobRoot = runtimeConfig.paths.jobRoot;
    this.modelRoot = runtimeConfig.paths.modelRoot;
    this.workerPath = path.join(runtimeConfig.projectRoot, 'backup', 'dev', 'server-workers', 'training-process-simulator.js');
    this.liveProcesses = new Map();
    this.pendingStops = new Set();
    STATUS_FOLDERS.forEach((folder) => fs.mkdirSync(path.join(this.jobRoot, folder), { recursive: true }));
  }

  getTrainingClient(trainingType = 'detector') {
    return trainingType === 'vlm' ? this.vlmClient : this.detectorClient;
  }

  usesRemoteApi(trainingType = 'detector') {
    return isRemoteMode(this.config.training) && this.getTrainingClient(trainingType).isConfigured();
  }

  previewCommand(input) {
    return Promise.resolve(buildTrainingCommand(input, this.config));
  }

  findJobDirectory(jobId) {
    for (const folder of STATUS_FOLDERS) {
      const candidate = path.join(this.jobRoot, folder, jobId);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  async listJobs() {
    const localJobs = this.listLocalJobs();
    if (localJobs.length || !this.usesRemoteApi('detector')) {
      return localJobs;
    }
    try {
      const remote = await this.detectorClient.listTrainingJobs();
      const jobs = Array.isArray(remote.jobs) ? remote.jobs.map(flattenRemoteTrainingJob) : [];
      if (jobs.length) {
        return jobs.sort((left, right) => String(right.startedAt || right.createdAt).localeCompare(String(left.startedAt || left.createdAt)));
      }
    } catch (error) {
      console.warn(`[TrainingJobService] 원격 학습 목록 조회 실패, 로컬 상태 사용: ${error.message}`);
    }
    return localJobs;
  }

  listLocalJobs() {
    const jobs = [];
    for (const folder of STATUS_FOLDERS) {
      const statusRoot = path.join(this.jobRoot, folder);
      for (const entry of fs.readdirSync(statusRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const jobDirectory = path.join(statusRoot, entry.name);
        const metadata = readJsonFile(path.join(jobDirectory, 'job.json'), null);
        if (!metadata) continue;
        const progress = readJsonFile(path.join(jobDirectory, 'progress.json'), {});
        const processInfo = readJsonFile(path.join(jobDirectory, 'process.json'), {});
        let status = progress.status || metadata.status || folder;
        if (
          folder === 'running'
          && status === 'running'
          && !isRemoteExecutionJob(metadata)
          && processInfo.pid
          && !processExists(processInfo.pid)
          && !this.liveProcesses.has(metadata.id)
        ) {
          status = 'status_unknown';
        }
        const enrichedProgress = folder === 'running'
          ? enrichProgressFromLogTail(jobDirectory, progress, metadata)
          : progress;
        jobs.push({
          ...metadata,
          ...enrichedProgress,
          status,
          directory: jobDirectory,
          logPath: path.join(jobDirectory, 'train.log'),
        });
      }
    }
    return jobs.sort((left, right) => String(right.startedAt || right.createdAt).localeCompare(String(left.startedAt || left.createdAt)));
  }

  async getJob(jobId, options = {}) {
    const localJob = this.listLocalJobs().find((job) => job.id === jobId);
    if (localJob) {
      if (options.connectionId && localJob.connectionId && localJob.connectionId !== options.connectionId) {
        return null;
      }
      return localJob;
    }
    for (const trainingType of ['detector', 'vlm']) {
      if (!this.usesRemoteApi(trainingType)) {
        continue;
      }
      try {
        const remoteJob = await this.getTrainingClient(trainingType).getTrainingJob(jobId);
        if (remoteJob && remoteJob.id) {
          return flattenRemoteTrainingJob(remoteJob);
        }
      } catch (error) {
        if (!error.message.includes('404')) {
          console.warn(`[TrainingJobService] 원격 학습 조회 실패 (${trainingType}): ${error.message}`);
        }
      }
    }
    return null;
  }

  async startJob(input) {
    if (this.usesRemoteApi()) {
      return this.startRemoteJob(input);
    }
    const command = buildTrainingCommand(input, this.config);
    const jobId = createJobId('train');
    const jobDirectory = path.join(this.jobRoot, 'running', jobId);
    fs.mkdirSync(jobDirectory, { recursive: true });
    const now = new Date().toISOString();
    const metadata = {
      id: jobId,
      connectionId: this.config.connectionId || null,
      name: command.normalizedParameters.name,
      trainingType: command.normalizedParameters.trainingType,
      modelType: command.normalizedParameters.trainingType === 'detector' ? '검출기' : 'VLM',
      datasetPath: command.normalizedParameters.datasetPath,
      outputPath: command.normalizedParameters.outputPath,
      command: command.preview,
      parameters: command.normalizedParameters,
      createdAt: now,
      startedAt: now,
      status: 'running',
      executionMode: this.config.training.executionMode,
    };
    writeJsonFileAtomic(path.join(jobDirectory, 'job.json'), metadata);
    writeJsonFileAtomic(path.join(jobDirectory, 'progress.json'), {
      status: 'running', epoch: 0, totalEpoch: command.normalizedParameters.epochs,
      step: 0, totalStep: command.normalizedParameters.epochs * 12,
      loss: null, progress: 0, elapsedSeconds: 0, updatedAt: now,
    });
    fs.writeFileSync(path.join(jobDirectory, 'command.txt'), `${command.preview}\n`, 'utf8');
    fs.writeFileSync(path.join(jobDirectory, 'train.log'), `[${new Date().toLocaleTimeString('ko-KR')}] 학습 작업 생성: ${jobId}\n`, 'utf8');

    if (this.config.training.executionMode === 'remote' || this.config.training.executionMode === 'agent') {
      await this.startAgentJob(jobDirectory, metadata, command);
    } else {
      this.startSimulatorJob(jobDirectory, metadata, command);
    }
    return this.getJob(jobId) || metadata;
  }

  async startRemoteJob(input) {
    const command = buildTrainingCommand(input, this.config);
    const jobId = createJobId('train');
    const jobDirectory = path.join(this.jobRoot, 'running', jobId);
    fs.mkdirSync(jobDirectory, { recursive: true });
    const now = new Date().toISOString();
    const metadata = {
      id: jobId,
      connectionId: this.config.connectionId || null,
      name: command.normalizedParameters.name,
      trainingType: command.normalizedParameters.trainingType,
      modelType: command.normalizedParameters.trainingType === 'detector' ? '검출기' : 'VLM',
      datasetPath: command.normalizedParameters.datasetPath,
      outputPath: command.normalizedParameters.outputPath,
      command: command.preview,
      parameters: command.normalizedParameters,
      createdAt: now,
      startedAt: now,
      status: 'running',
      executionMode: 'remote',
    };
    writeJsonFileAtomic(path.join(jobDirectory, 'job.json'), metadata);
    writeJsonFileAtomic(path.join(jobDirectory, 'progress.json'), {
      status: 'running',
      epoch: 0,
      totalEpoch: command.normalizedParameters.epochs,
      step: 0,
      totalStep: command.normalizedParameters.epochs * 12,
      loss: null,
      progress: 0,
      elapsedSeconds: 0,
      updatedAt: now,
    });
    fs.writeFileSync(path.join(jobDirectory, 'command.txt'), `${command.preview}\n`, 'utf8');
    fs.writeFileSync(path.join(jobDirectory, 'train.log'), `[${new Date().toLocaleTimeString('ko-KR')}] 원격 학습 작업 생성: ${jobId}\n`, 'utf8');
    await this.startAgentJob(jobDirectory, metadata, command);
    return this.getJob(jobId) || metadata;
  }

  async ensureRemoteDatasetSplit(parameters, jobDirectory, jobId) {
    if (parameters.trainingType !== 'detector' || !this.usesRemoteApi()) {
      return parameters;
    }

    const logPath = path.join(jobDirectory, 'train.log');
    const appendLog = (line) => fs.appendFileSync(logPath, `${line}\n`, 'utf8');
    appendLog('[Agent] train/valid 목록 확인 · split 준비 중...');

    const splitTaskId = `split_before_${jobId}`;
    const accepted = await this.detectorClient.submitCommand({
      taskId: splitTaskId,
      commandType: 'dataset.split',
      payload: {
        name: parameters.name,
        modelName: parameters.name,
        datasetPath: parameters.datasetPath,
        datasetPaths: parameters.datasetPaths,
        trainRatio: Number(parameters.trainRatio) || 0.9,
        dataListsRoot: this.config.training?.dataListsRoot || 'detector/data',
      },
    });

    const task = await this.detectorClient.waitForCommandTask(accepted.taskId || splitTaskId, {
      timeoutMs: 180000,
    });
    if (task.status !== 'completed') {
      throw Object.assign(new Error(task.errorMessage || '학습 전 split 준비 실패'), {
        logs: task.logs,
        logText: task.logText,
      });
    }

    const result = task.result || {};
    if (result.trainPath) parameters.trainPath = result.trainPath;
    if (result.valPath) parameters.valPath = result.valPath;
    appendLog(`[Agent] split 준비 완료: train=${parameters.trainPath}, val=${parameters.valPath}`);
    if (result.reusedExistingSplit) {
      appendLog('[Agent] 기존 split 파일을 재사용했습니다.');
    }
    return parameters;
  }

  async startAgentJob(jobDirectory, metadata, command) {
    const client = this.getTrainingClient(metadata.trainingType || command.normalizedParameters.trainingType);
    const callbackUrl = client.buildCallbackUrl(`/api/training/jobs/${metadata.id}/callback`);
    const parameters = { ...command.normalizedParameters };
    try {
      await this.ensureRemoteDatasetSplit(parameters, jobDirectory, metadata.id);
    } catch (error) {
      fs.appendFileSync(path.join(jobDirectory, 'train.log'), `[ERR ] split 준비 실패: ${error.message}\n`, 'utf8');
      this.finalizeJob(jobDirectory, metadata, 1, error.message);
      throw error;
    }
    if (parameters.trainingType === 'detector' && parameters.datasetConfigPath) {
      try {
        const preview = new DatasetConfigService(this.config).buildPreview(parameters);
        parameters.datasetConfigYaml = preview.yaml;
        parameters.datasetConfigAbsolutePath = preview.absoluteConfigPath;
      } catch (error) {
        console.warn(`[TrainingJobService] data.yaml 생성 미리보기 실패, 학습 서버 기존 파일 사용: ${error.message}`);
      }
    }
    try {
      const result = await client.startTrainingJob({
        jobId: metadata.id,
        executable: command.executable,
        args: command.args,
        metadata,
        callbackUrl,
        parameters,
      });
      writeJsonFileAtomic(path.join(jobDirectory, 'process.json'), {
        remoteJobId: result.remoteJobId || result.id || metadata.id,
        pid: result.pid || null,
        callbackUrl,
      });
      fs.appendFileSync(
        path.join(jobDirectory, 'train.log'),
        `[Agent] 원격 작업 시작: ${result.remoteJobId || result.id || metadata.id}\n`,
      );
    } catch (error) {
      this.finalizeJob(jobDirectory, metadata, 1, error.message);
      throw error;
    }
  }

  startSimulatorJob(jobDirectory, metadata, command) {
    const totalSteps = command.normalizedParameters.epochs * 12;
    const child = spawnSafeProcess(process.execPath, [
      this.workerPath,
      '--job-id', metadata.id,
      '--name', metadata.name,
      '--type', metadata.trainingType,
      '--epochs', String(command.normalizedParameters.epochs),
      '--steps', String(totalSteps),
    ], { cwd: this.config.projectRoot });

    this.liveProcesses.set(metadata.id, child);
    writeJsonFileAtomic(path.join(jobDirectory, 'process.json'), { pid: child.pid, startedAt: new Date().toISOString() });
    let stdoutBuffer = '';
    const consume = (chunk, isError = false) => {
      const text = chunk.toString('utf8');
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('__MLOPS_PROGRESS__')) {
          const progress = JSON.parse(line.slice('__MLOPS_PROGRESS__'.length));
          writeJsonFileAtomic(path.join(jobDirectory, 'progress.json'), progress);
        } else if (line) {
          fs.appendFileSync(path.join(jobDirectory, 'train.log'), `${isError ? '[stderr] ' : ''}${line}\n`, 'utf8');
        }
      }
    };
    child.stdout.on('data', (chunk) => consume(chunk, false));
    child.stderr.on('data', (chunk) => consume(chunk, true));
    child.on('error', (error) => this.finalizeJob(jobDirectory, metadata, 1, error.message));
    child.on('close', (exitCode) => {
      if (stdoutBuffer.trim()) fs.appendFileSync(path.join(jobDirectory, 'train.log'), `${stdoutBuffer.trim()}\n`);
      const cancelled = this.pendingStops.has(metadata.id);
      this.pendingStops.delete(metadata.id);
      this.liveProcesses.delete(metadata.id);
      if (cancelled) {
        this.finalizeJob(jobDirectory, metadata, exitCode || 143, '사용자에 의해 학습이 중지되었습니다.', { cancelled: true });
        return;
      }
      this.finalizeJob(jobDirectory, metadata, exitCode || 0, exitCode ? `프로세스 종료 코드: ${exitCode}` : null);
    });
  }

  createModelArtifact(metadata, jobDirectory, progress) {
    const safeModelName = metadata.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const modelDirectory = path.join(this.modelRoot, safeModelName);
    fs.mkdirSync(modelDirectory, { recursive: true });
    const modelFile = path.join(modelDirectory, `${safeModelName}.pt`);
    if (!fs.existsSync(modelFile)) {
      fs.writeFileSync(modelFile, `MLOPS DEMO MODEL\nsource_job=${metadata.id}\n`, 'utf8');
    }
    writeJsonFileAtomic(path.join(modelDirectory, 'model-metadata.json'), {
      modelName: metadata.name,
      modelType: metadata.modelType,
      trainingType: metadata.trainingType,
      sourceJobId: metadata.id,
      datasetPath: metadata.datasetPath,
      finalEpoch: progress.epoch,
      finalStep: progress.step,
      finalLoss: progress.loss,
      learningRate: metadata.parameters?.learningRate ?? null,
      completedAt: new Date().toISOString(),
      modelFile,
      status: 'completed',
    });
    return modelFile;
  }

  finalizeJob(jobDirectory, metadata, exitCode, errorMessage, options = {}) {
    if (!fs.existsSync(jobDirectory)) return;
    const existingProgress = readJsonFile(path.join(jobDirectory, 'progress.json'), {});
    const cancelled = Boolean(options.cancelled);
    const completed = !cancelled && exitCode === 0;
    const finalStatus = completed ? 'completed' : (cancelled ? 'cancelled' : 'failed');
    const finishedAt = new Date().toISOString();
    let modelFile = null;
    if (completed) {
      modelFile = this.createModelArtifact(metadata, jobDirectory, existingProgress);
    }
    const finalProgress = {
      ...existingProgress,
      status: finalStatus,
      progress: completed ? 100 : Number(existingProgress.progress || 0),
      exitCode,
      errorMessage: errorMessage || null,
      modelFile,
      finishedAt,
      updatedAt: finishedAt,
    };
    writeJsonFileAtomic(path.join(jobDirectory, 'progress.json'), finalProgress);
    writeJsonFileAtomic(path.join(jobDirectory, 'job.json'), { ...metadata, status: finalStatus, finishedAt, modelFile });
    const statusLabel = completed ? '학습 완료' : (cancelled ? '학습 중지' : `학습 실패: ${errorMessage || '알 수 없는 오류'}`);
    fs.appendFileSync(path.join(jobDirectory, 'train.log'), `[${new Date().toLocaleTimeString('ko-KR')}] ${statusLabel}\n`);
    const destination = path.join(this.jobRoot, completed ? 'completed' : 'failed', metadata.id);
    if (path.resolve(destination) !== path.resolve(jobDirectory)) {
      fs.renameSync(jobDirectory, destination);
    }
  }


  applyAgentCallback(jobId, payload = {}) {
    const jobDirectory = this.findJobDirectory(jobId);
    if (!jobDirectory) {
      throw Object.assign(new Error('콜백 대상 학습 작업을 찾을 수 없습니다.'), { statusCode: 404 });
    }
    const metadataPath = path.join(jobDirectory, 'job.json');
    const progressPath = path.join(jobDirectory, 'progress.json');
    const logPath = path.join(jobDirectory, 'train.log');
    const metadata = readJsonFile(metadataPath, {});
    const previousProgress = readJsonFile(progressPath, {});

    if (payload.log) {
      fs.appendFileSync(logPath, String(payload.log).endsWith('\n') ? String(payload.log) : `${payload.log}\n`, 'utf8');
    }

    let callbackProgress = payload.progress && typeof payload.progress === 'object' ? payload.progress : {};
    if (payload.log) {
      const parsedFromLog = parseTrainingProgressFromLogLine(payload.log);
      if (parsedFromLog) {
        callbackProgress = { ...callbackProgress, ...parsedFromLog };
      }
    }

    const requestedStatus = payload.status || callbackProgress.status || previousProgress.status || 'running';
    const updatedAt = new Date().toISOString();
    if (requestedStatus === 'running' && metadata.startedAt) {
      callbackProgress.elapsedSeconds = Math.floor((Date.now() - new Date(metadata.startedAt).getTime()) / 1000);
    }
    const nextProgress = {
      ...previousProgress,
      ...callbackProgress,
      status: requestedStatus,
      updatedAt,
    };
    writeJsonFileAtomic(progressPath, nextProgress);

    if (!['completed', 'failed', 'cancelled'].includes(requestedStatus)) {
      writeJsonFileAtomic(metadataPath, { ...metadata, status: requestedStatus });
      return { ...metadata, ...nextProgress };
    }

    let finalStatus = requestedStatus;
    let errorMessage = payload.errorMessage || callbackProgress.errorMessage || null;
    let modelFile = payload.modelFile || callbackProgress.modelFile || null;
    const remoteJob = isRemoteExecutionJob(metadata);
    if (requestedStatus === 'completed') {
      if (!modelFile) {
        finalStatus = 'failed';
        errorMessage = errorMessage || '학습 완료 콜백을 받았지만 modelFile 경로가 없습니다.';
      } else if (!remoteJob && !fs.existsSync(modelFile)) {
        finalStatus = 'failed';
        errorMessage = errorMessage || '학습 완료 콜백을 받았지만 모델 파일을 확인할 수 없습니다.';
      }
    }

    const finishedAt = payload.finishedAt || updatedAt;
    const storedModelFile = modelFile && remoteJob
      ? toRelativeTrainingPath(modelFile, getTrainingWorkspaceRoot(this.config))
      : modelFile;
    const finalProgress = {
      ...nextProgress,
      status: finalStatus,
      progress: finalStatus === 'completed' ? 100 : Number(nextProgress.progress || 0),
      exitCode: payload.exitCode ?? (finalStatus === 'completed' ? 0 : 1),
      errorMessage,
      modelFile: storedModelFile || null,
      remoteModelFile: remoteJob ? modelFile : null,
      finishedAt,
      updatedAt,
    };
    writeJsonFileAtomic(progressPath, finalProgress);
    writeJsonFileAtomic(metadataPath, { ...metadata, status: finalStatus, finishedAt, modelFile: storedModelFile || null });

    if (finalStatus === 'completed' && modelFile) {
      const safeModelName = metadata.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const modelDirectory = path.join(this.modelRoot, safeModelName);
      fs.mkdirSync(modelDirectory, { recursive: true });
      writeJsonFileAtomic(path.join(modelDirectory, 'model-metadata.json'), {
        modelName: metadata.name,
        modelType: metadata.modelType,
        trainingType: metadata.trainingType,
        sourceJobId: metadata.id,
        datasetPath: metadata.datasetPath,
        finalEpoch: finalProgress.epoch,
        finalStep: finalProgress.step,
        finalLoss: finalProgress.loss,
        learningRate: metadata.parameters?.learningRate ?? null,
        completedAt: finishedAt,
        modelFile: storedModelFile || modelFile,
        remoteModelFile: remoteJob ? modelFile : null,
        status: 'completed',
      });
    }

    fs.appendFileSync(logPath, `[${new Date().toLocaleTimeString('ko-KR')}] ${
      finalStatus === 'completed'
        ? '학습 완료 콜백 수신'
        : (finalStatus === 'cancelled'
          ? '학습 중지 콜백 수신'
          : `학습 실패 콜백 수신: ${errorMessage || '알 수 없는 오류'}`)
    }\n`, 'utf8');
    const destination = path.join(this.jobRoot, finalStatus === 'completed' ? 'completed' : 'failed', metadata.id);
    if (path.resolve(destination) !== path.resolve(jobDirectory)) {
      fs.renameSync(jobDirectory, destination);
    }
    const job = this.listLocalJobs().find((item) => item.id === jobId);
    return job || { ...metadata, ...finalProgress };
  }

  getLogPath(jobId) {
    const directory = this.findJobDirectory(jobId);
    return directory ? path.join(directory, 'train.log') : null;
  }

  async stopJob(jobId) {
    const jobDirectory = this.findJobDirectory(jobId);
    if (!jobDirectory) {
      throw Object.assign(new Error('학습 작업을 찾을 수 없습니다.'), { statusCode: 404 });
    }

    const metadataPath = path.join(jobDirectory, 'job.json');
    const progressPath = path.join(jobDirectory, 'progress.json');
    const logPath = path.join(jobDirectory, 'train.log');
    const metadata = readJsonFile(metadataPath, {});
    const progress = readJsonFile(progressPath, {});
    const status = progress.status || metadata.status;

    if (status !== 'running') {
      throw Object.assign(new Error('실행 중인 학습만 중지할 수 있습니다.'), { statusCode: 409 });
    }

    const appendLog = (line) => fs.appendFileSync(logPath, `${line}\n`, 'utf8');
    appendLog('[STOP] 사용자가 학습 중지를 요청했습니다.');

    const liveChild = this.liveProcesses.get(jobId);
    if (liveChild) {
      this.pendingStops.add(jobId);
      liveChild.kill('SIGTERM');
      return this.getJob(jobId) || { ...metadata, ...progress, status: 'cancelled' };
    }

    const processInfo = readJsonFile(path.join(jobDirectory, 'process.json'), {});
    const trainingType = metadata.trainingType || 'detector';
    const client = this.getTrainingClient(trainingType);
    const remoteJobId = processInfo.remoteJobId || metadata.id;

    if (isRemoteExecutionJob(metadata) && client.isConfigured()) {
      appendLog(`[STOP] 학습 서버 agent(${trainingType})에 중지 요청 전송...`);
      await client.stopTrainingJob(remoteJobId);
      const updated = this.getJob(jobId);
      if (updated && updated.status === 'running') {
        return this.applyAgentCallback(jobId, {
          status: 'cancelled',
          errorMessage: '사용자에 의해 학습이 중지되었습니다.',
          finishedAt: new Date().toISOString(),
          log: '[STOP] 학습이 중지되었습니다.\n',
        });
      }
      return updated || this.getJob(jobId);
    }

    if (processInfo.pid && processExists(processInfo.pid)) {
      try {
        process.kill(processInfo.pid, 'SIGTERM');
      } catch (error) {
        throw Object.assign(new Error(`학습 프로세스 중지 실패: ${error.message}`), { statusCode: 500 });
      }
      this.finalizeJob(jobDirectory, metadata, 143, '사용자에 의해 학습이 중지되었습니다.', { cancelled: true });
      return this.getJob(jobId);
    }

    throw Object.assign(new Error('중지할 학습 프로세스를 찾을 수 없습니다.'), { statusCode: 409 });
  }
}

module.exports = {
  TrainingJobService,
  buildTrainingCommand,
  parseTrainingProgressFromLogLine,
};
