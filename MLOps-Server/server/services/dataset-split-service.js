'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { listImagesRecursively } = require('./file-system-inspection-service');
const { resolveLocalDatasetScanPath, normalizeDatasetPaths } = require('./dataset-config-service');
const { getTrainingWorkspaceRoot } = require('../utils/training-path-resolver');

const DEFAULT_TRAIN_RATIO = 0.9;
const DEFAULT_DATA_LISTS_ROOT = 'detector/data';
const TRAIN_LIST_NAME = 'train.txt';
const VAL_LIST_NAME = 'valid.txt';

function getDataListsRoot(runtimeConfig) {
  return String(runtimeConfig?.training?.dataListsRoot || DEFAULT_DATA_LISTS_ROOT).replace(/^\/+/, '');
}

function sanitizeModelFolderName(modelName) {
  const sanitized = String(modelName || 'model')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || 'model';
}

function buildSplitRelativePaths(modelFolderName, dataListsRoot = DEFAULT_DATA_LISTS_ROOT) {
  const base = `${dataListsRoot}/${modelFolderName}`;
  return {
    modelFolderName,
    splitDirectory: base,
    trainPath: `${base}/${TRAIN_LIST_NAME}`,
    valPath: `${base}/${VAL_LIST_NAME}`,
  };
}

function resolveLocalWorkspaceFromDataRoot(dataRoot) {
  if (!dataRoot || !fs.existsSync(dataRoot)) {
    return null;
  }
  if (path.basename(dataRoot).toLowerCase() === 'dataset') {
    return path.dirname(dataRoot);
  }
  return null;
}

function resolveAvailableModelFolder(dataListsDirectory, modelName) {
  const sanitized = sanitizeModelFolderName(modelName);
  let candidate = sanitized;
  let suffix = 2;
  while (fs.existsSync(path.join(dataListsDirectory, candidate))) {
    candidate = `${sanitized}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function folderHasSplitFiles(folderPath) {
  return fs.existsSync(path.join(folderPath, TRAIN_LIST_NAME))
    && fs.existsSync(path.join(folderPath, VAL_LIST_NAME));
}

function detectExistingSplitForModel(modelName, runtimeConfig) {
  const dataListsRoot = getDataListsRoot(runtimeConfig);
  const workspaceLocal = resolveLocalWorkspaceFromDataRoot(runtimeConfig.paths.dataRoot);
  if (!workspaceLocal) {
    return null;
  }
  const dataListsDirectory = path.join(workspaceLocal, dataListsRoot);
  if (!fs.existsSync(dataListsDirectory)) {
    return null;
  }

  const sanitized = sanitizeModelFolderName(modelName);
  const exactFolder = path.join(dataListsDirectory, sanitized);
  if (folderHasSplitFiles(exactFolder)) {
    const paths = buildSplitRelativePaths(sanitized, dataListsRoot);
    return {
      ...paths,
      trainListPath: path.join(exactFolder, TRAIN_LIST_NAME),
      valListPath: path.join(exactFolder, VAL_LIST_NAME),
    };
  }

  const numberedMatches = fs.readdirSync(dataListsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${sanitized}_`))
    .map((entry) => entry.name)
    .filter((folderName) => folderHasSplitFiles(path.join(dataListsDirectory, folderName)))
    .sort((left, right) => {
      const leftSuffix = Number(left.slice(sanitized.length + 1)) || 0;
      const rightSuffix = Number(right.slice(sanitized.length + 1)) || 0;
      return rightSuffix - leftSuffix;
    });

  if (!numberedMatches.length) {
    return null;
  }

  const modelFolderName = numberedMatches[0];
  const folderPath = path.join(dataListsDirectory, modelFolderName);
  const paths = buildSplitRelativePaths(modelFolderName, dataListsRoot);
  return {
    ...paths,
    trainListPath: path.join(folderPath, TRAIN_LIST_NAME),
    valListPath: path.join(folderPath, VAL_LIST_NAME),
  };
}

function suggestSplitPathsForModel(modelName, runtimeConfig) {
  const dataListsRoot = getDataListsRoot(runtimeConfig);
  const sanitized = sanitizeModelFolderName(modelName);
  const existingSplit = detectExistingSplitForModel(modelName, runtimeConfig);
  if (existingSplit) {
    return {
      ...existingSplit,
      exists: true,
      trainCount: countLinesInFile(existingSplit.trainListPath),
      valCount: countLinesInFile(existingSplit.valListPath),
    };
  }
  const paths = buildSplitRelativePaths(sanitized, dataListsRoot);
  return {
    ...paths,
    exists: false,
    trainCount: null,
    valCount: null,
  };
}

function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  if (state === 0) {
    state = 42;
  }
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffleInPlace(items, seed = 42) {
  const random = createSeededRandom(seed);
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[index], items[swapIndex]];
  }
  return items;
}

function findScanResultForImage(imagePath, scanResults) {
  const resolved = path.resolve(imagePath);
  let best = scanResults[0];
  let bestRootLength = -1;
  for (const scanResult of scanResults) {
    const root = path.resolve(scanResult.localPath);
    const relative = path.relative(root, resolved);
    const isInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    if (isInside && root.length > bestRootLength) {
      best = scanResult;
      bestRootLength = root.length;
    }
  }
  return best;
}

function toWorkspaceRelativeImagePath(relativeDatasetPath, localDatasetPath, imagePath) {
  const relativeWithinDataset = path.relative(localDatasetPath, imagePath).split(path.sep).join('/');
  return relativeWithinDataset
    ? `${relativeDatasetPath}/${relativeWithinDataset}`
    : relativeDatasetPath;
}

function resolveSplitListPaths(trainPath = '', valPath = '') {
  const normalizedTrain = String(trainPath || '').trim() || '.';
  const normalizedVal = String(valPath || '').trim() || normalizedTrain;
  return {
    trainPath: normalizedTrain,
    valPath: normalizedVal,
  };
}

function usesWorkspaceRelativeLists(trainPath) {
  const normalized = String(trainPath || '').replace(/^\/+/, '');
  return normalized.startsWith(`${DEFAULT_DATA_LISTS_ROOT}/`)
    || normalized.startsWith('detector/data/');
}

function resolveListFileAbsolutePath(trainOrValPath, runtimeConfig, localDatasetPath) {
  const normalized = String(trainOrValPath || '').trim();
  if (!normalized.endsWith('.txt')) {
    return null;
  }
  if (usesWorkspaceRelativeLists(normalized)) {
    const workspaceLocal = resolveLocalWorkspaceFromDataRoot(runtimeConfig.paths.dataRoot);
    return workspaceLocal ? path.join(workspaceLocal, normalized) : null;
  }
  return path.join(localDatasetPath, normalized);
}

function countLinesInFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return 0;
  }
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
}

function writeSplitListFile(filePath, imagePaths) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = imagePaths.length ? `${imagePaths.join('\n')}\n` : '';
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function createSplitLogger() {
  const lines = [];
  return {
    info(message) {
      lines.push(`[INFO] ${message}`);
      return this;
    },
    step(message) {
      lines.push(`[STEP] ${message}`);
      return this;
    },
    ok(message) {
      lines.push(`[ OK ] ${message}`);
      return this;
    },
    warn(message) {
      lines.push(`[WARN] ${message}`);
      return this;
    },
    error(message) {
      lines.push(`[ERR ] ${message}`);
      return this;
    },
    toArray() {
      return [...lines];
    },
    text() {
      return lines.join('\n');
    },
  };
}

function sampleLines(lines, maximum = 3) {
  return lines.slice(0, maximum);
}

function createDatasetSplit(input = {}, runtimeConfig) {
  const log = createSplitLogger();
  const modelName = String(input.name || input.modelName || '').trim();
  if (!modelName) {
    log.error('학습명(name)이 필요합니다.');
    throw Object.assign(
      new Error('학습명(name)이 필요합니다. split 폴더명으로 사용됩니다.'),
      { statusCode: 400, logs: log.toArray(), logText: log.text(), status: 'failed' },
    );
  }

  log.info(`학습명: ${modelName}`);
  const datasetPaths = normalizeDatasetPaths(input);
  if (!datasetPaths.length) {
    log.error('학습 데이터셋 경로가 필요합니다.');
    throw Object.assign(
      new Error('학습 데이터셋 경로를 하나 이상 선택하세요.'),
      { statusCode: 400, logs: log.toArray(), logText: log.text(), status: 'failed' },
    );
  }
  log.info(`데이터셋: ${datasetPaths.join(', ')}`);

  const trainRatio = Number(input.trainRatio ?? DEFAULT_TRAIN_RATIO);
  if (!Number.isFinite(trainRatio) || trainRatio <= 0 || trainRatio >= 1) {
    log.error('trainRatio는 0과 1 사이여야 합니다.');
    throw new Error('trainRatio는 0과 1 사이의 값이어야 합니다.');
  }

  log.step('데이터셋 폴더 확인 중...');
  const scanResults = datasetPaths.map((relativeDatasetPath) => (
    resolveLocalDatasetScanPath(relativeDatasetPath, runtimeConfig)
  ));
  const relativeDatasetPath = datasetPaths.join(',');
  scanResults.forEach((scanResult) => {
    log.ok(`데이터셋 경로 확인: ${scanResult.relativeDatasetPath}`);
  });

  log.step('이미지 파일 검색 중...');
  const imageSet = new Set();
  for (const scanResult of scanResults) {
    for (const imagePath of listImagesRecursively(scanResult.localPath, Number(input.maximumImages) || 50000)) {
      imageSet.add(path.resolve(imagePath));
    }
  }
  const images = [...imageSet];
  if (!images.length) {
    log.error('split할 이미지가 없습니다.');
    throw Object.assign(new Error('split할 이미지가 없습니다.'), {
      statusCode: 400,
      logs: log.toArray(),
      logText: log.text(),
      status: 'failed',
    });
  }
  log.ok(`이미지 ${images.length}장 발견`);

  const dataListsRoot = getDataListsRoot(runtimeConfig);
  const workspaceLocal = resolveLocalWorkspaceFromDataRoot(runtimeConfig.paths.dataRoot);
  if (!workspaceLocal) {
    log.error('로컬 workspace에서 detector/data 경로를 쓸 수 없습니다.');
    throw Object.assign(
      new Error('detector/data 경로를 로컬에 쓸 수 없습니다. remote 모드에서는 학습 서버 agent가 split을 생성합니다.'),
      { statusCode: 503, logs: log.toArray(), logText: log.text(), status: 'failed' },
    );
  }

  const dataListsDirectory = path.join(workspaceLocal, dataListsRoot);
  fs.mkdirSync(dataListsDirectory, { recursive: true });
  const modelFolderName = resolveAvailableModelFolder(dataListsDirectory, modelName);
  const splitPaths = buildSplitRelativePaths(modelFolderName, dataListsRoot);
  const splitDirectory = path.join(workspaceLocal, splitPaths.splitDirectory);
  const trainListPath = path.join(splitDirectory, TRAIN_LIST_NAME);
  const valListPath = path.join(splitDirectory, VAL_LIST_NAME);

  if (modelFolderName !== sanitizeModelFolderName(modelName)) {
    log.warn(`동일 학습명 폴더 존재 → ${modelFolderName} 폴더 사용`);
  } else {
    log.ok(`출력 폴더: ${splitPaths.splitDirectory}`);
  }

  log.step(`9:1 비율로 분할 중 (train ${Math.round(trainRatio * 100)}% / valid ${Math.round((1 - trainRatio) * 100)}%)...`);
  const seed = Number.isFinite(Number(input.seed))
    ? Number(input.seed)
    : Number.parseInt(
      crypto.createHash('md5').update(`${relativeDatasetPath}:${modelFolderName}`).digest('hex').slice(0, 8),
      16,
    );
  const shuffled = shuffleInPlace([...images], seed);
  const valCount = shuffled.length < 2
    ? 0
    : Math.max(1, Math.round(shuffled.length * (1 - trainRatio)));
  const trainImages = shuffled.slice(0, shuffled.length - valCount);
  const valImages = shuffled.slice(shuffled.length - valCount);

  const trainRelativePaths = trainImages.map((imagePath) => {
    const scanResult = findScanResultForImage(imagePath, scanResults);
    return toWorkspaceRelativeImagePath(
      scanResult.relativeDatasetPath,
      scanResult.localPath,
      imagePath,
    );
  });
  const valRelativePaths = valImages.map((imagePath) => {
    const scanResult = findScanResultForImage(imagePath, scanResults);
    return toWorkspaceRelativeImagePath(
      scanResult.relativeDatasetPath,
      scanResult.localPath,
      imagePath,
    );
  });

  log.step('train.txt / valid.txt 작성 중...');
  writeSplitListFile(trainListPath, trainRelativePaths);
  writeSplitListFile(valListPath, valRelativePaths);
  log.ok(`train.txt 작성 완료 (${trainImages.length} lines)`);
  log.ok(`valid.txt 작성 완료 (${valImages.length} lines)`);

  sampleLines(trainRelativePaths).forEach((line) => log.info(`  train sample: ${line}`));
  sampleLines(valRelativePaths).forEach((line) => log.info(`  valid sample: ${line}`));

  const warnings = [];
  if (valImages.length === 0) {
    warnings.push('이미지가 1장뿐이라 valid 목록이 비어 있습니다.');
    log.warn('valid 목록이 비어 있습니다.');
  }
  if (modelFolderName !== sanitizeModelFolderName(modelName)) {
    warnings.push(`동일 학습명 폴더가 있어 ${modelFolderName} 폴더를 생성했습니다.`);
  }

  log.ok('split 생성 완료');

  return {
    relativeDatasetPath,
    modelName,
    modelFolderName,
    dataListsRoot,
    splitDirectory: splitPaths.splitDirectory,
    trainPath: splitPaths.trainPath,
    valPath: splitPaths.valPath,
    trainListPath,
    valListPath,
    trainCount: trainImages.length,
    valCount: valImages.length,
    totalCount: shuffled.length,
    trainRatio,
    seed,
    warnings,
    logs: log.toArray(),
    logText: log.text(),
    status: 'completed',
    executionTarget: 'local',
    message: `9:1 split 생성 완료 · ${splitPaths.splitDirectory} (train ${trainImages.length}, valid ${valImages.length})`,
  };
}

module.exports = {
  DEFAULT_TRAIN_RATIO,
  DEFAULT_DATA_LISTS_ROOT,
  TRAIN_LIST_NAME,
  VAL_LIST_NAME,
  getDataListsRoot,
  sanitizeModelFolderName,
  buildSplitRelativePaths,
  resolveLocalWorkspaceFromDataRoot,
  resolveAvailableModelFolder,
  detectExistingSplitForModel,
  suggestSplitPathsForModel,
  createSplitLogger,
  sampleLines,
  createDatasetSplit,
  resolveSplitListPaths,
  usesWorkspaceRelativeLists,
  resolveListFileAbsolutePath,
  countLinesInFile,
  shuffleInPlace,
};
