'use strict';

const fs = require('fs');
const path = require('path');
const { discoverClassNames, parseClassNamesFromText } = require('./yolo-label-service');
const { listImagesRecursively } = require('./file-system-inspection-service');
const {
  assertRelativeTrainingPath,
  getTrainingWorkspaceRoot,
  resolveTrainingServerPath,
} = require('../utils/training-path-resolver');
const {
  extractDatasetFolderName,
  getClassFolderRoot,
  isReservedDatasetRootName,
  listImageDatasetFolders,
  resolveClassDefinitionFile,
  resolveClassDefinitionPath,
  toDatasetRelativePath,
  usesImagesLayout,
} = require('../utils/dataset-layout');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);

function findPathCaseInsensitive(baseDir, relativeParts) {
  let current = baseDir;
  for (const part of relativeParts) {
    if (!fs.existsSync(current)) {
      return null;
    }
    const exact = path.join(current, part);
    if (fs.existsSync(exact)) {
      current = exact;
      continue;
    }
    const entries = fs.readdirSync(current);
    const match = entries.find((entry) => entry.toLowerCase() === part.toLowerCase());
    if (!match) {
      return null;
    }
    current = path.join(current, match);
  }
  return current;
}

function normalizeDatasetPaths(input = {}) {
  if (Array.isArray(input.datasetPaths) && input.datasetPaths.length) {
    return input.datasetPaths
      .map((item) => assertRelativeTrainingPath(item, '학습 데이터셋 경로'))
      .filter(Boolean);
  }
  const raw = String(input.datasetPath || '').trim();
  if (!raw) {
    return [];
  }
  if (raw.includes(',')) {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => assertRelativeTrainingPath(item, '학습 데이터셋 경로'));
  }
  return [assertRelativeTrainingPath(raw, '학습 데이터셋 경로')];
}

function resolveMultipleLocalDatasetScanPaths(relativeDatasetPaths, runtimeConfig) {
  const paths = normalizeDatasetPaths({ datasetPaths: relativeDatasetPaths });
  if (!paths.length) {
    throw new Error('학습 데이터셋 경로를 하나 이상 선택하세요.');
  }
  return paths.map((relativeDatasetPath) => resolveLocalDatasetScanPath(relativeDatasetPath, runtimeConfig));
}

function countLabelsFromMultiplePaths(localPaths, maximumFiles = 5000) {
  const totals = {
    imageCount: 0,
    labelCount: 0,
    truncated: false,
  };
  for (const localPath of localPaths) {
    const counts = countLabelsRecursively(localPath, maximumFiles);
    totals.imageCount += counts.imageCount;
    totals.labelCount += counts.labelCount;
    totals.truncated = totals.truncated || counts.truncated;
  }
  return totals;
}

function discoverClassNamesForMultipleDatasets(
  scanResults,
  dataRoot,
  requestedClassPath,
  classDefinitionText,
) {
  const classDefinition = String(classDefinitionText || '').trim();
  if (classDefinition) {
    return discoverClassNamesForTraining(
      scanResults[0].localPath,
      dataRoot,
      requestedClassPath,
      classDefinitionText,
    );
  }

  const classNames = [];
  const seen = new Set();
  let classSource = 'merged-class-files';
  let relativeClassDefinitionPath = '';

  for (const scanResult of scanResults) {
    const folderName = extractDatasetFolderName(scanResult.relativeDatasetPath);
    const classFile = resolveClassDefinitionFile(dataRoot, folderName);
    const discovered = discoverClassNamesForTraining(
      scanResult.localPath,
      dataRoot,
      classFile ? toDatasetRelativePath(dataRoot, classFile) : requestedClassPath,
      '',
    );
    if (!relativeClassDefinitionPath && discovered.relativeClassDefinitionPath) {
      relativeClassDefinitionPath = discovered.relativeClassDefinitionPath;
    }
    for (const name of discovered.classNames) {
      if (seen.has(name)) continue;
      seen.add(name);
      classNames.push(name);
    }
  }

  if (!classNames.length) {
    return discoverClassNamesForTraining(
      scanResults[0].localPath,
      dataRoot,
      requestedClassPath,
      classDefinitionText,
    );
  }

  return {
    classNames,
    classSource,
    relativeClassDefinitionPath,
  };
}

function resolveLocalDatasetScanPath(relativeDatasetPath, runtimeConfig) {
  const normalized = assertRelativeTrainingPath(relativeDatasetPath, '학습 데이터셋 경로');
  const dataRoot = runtimeConfig.paths.dataRoot;
  let subPath = normalized;
  if (normalized === 'dataset' || normalized.startsWith('dataset/')) {
    subPath = normalized === 'dataset' ? '' : normalized.slice('dataset/'.length);
  }

  const directPath = subPath ? path.join(dataRoot, subPath) : dataRoot;
  if (fs.existsSync(directPath)) {
    return { localPath: directPath, relativeDatasetPath: normalized };
  }

  const parts = subPath.split('/').filter(Boolean);
  const resolvedPath = parts.length ? findPathCaseInsensitive(dataRoot, parts) : dataRoot;
  if (resolvedPath && fs.existsSync(resolvedPath)) {
    return {
      localPath: resolvedPath,
      relativeDatasetPath: toDatasetRelativePath(dataRoot, resolvedPath),
    };
  }

  const available = fs.readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => `dataset/${entry.name}`)
    .slice(0, 8);

  const hint = available.length
    ? ` 사용 가능한 폴더: ${available.join(', ')}`
    : '';
  throw Object.assign(
    new Error(`동기화된 데이터셋 폴더를 찾을 수 없습니다: ${relativeDatasetPath}.${hint}`),
    { statusCode: 404 },
  );
}

function toWorkspaceDatasetRelativePath(dataRoot, absolutePath) {
  const relative = path.relative(dataRoot, absolutePath).split(path.sep).join('/');
  return relative ? `dataset/${relative}` : 'dataset';
}

function resolveLocalClassDefinitionPath(relativeClassPath, runtimeConfig) {
  const normalized = assertRelativeTrainingPath(relativeClassPath, '클래스 정의 txt');
  const dataRoot = runtimeConfig.paths.dataRoot;
  let subPath = normalized;
  if (normalized === 'dataset' || normalized.startsWith('dataset/')) {
    subPath = normalized === 'dataset' ? '' : normalized.slice('dataset/'.length);
  }

  const directPath = subPath ? path.join(dataRoot, subPath) : dataRoot;
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return {
      localPath: directPath,
      relativeClassDefinitionPath: toWorkspaceDatasetRelativePath(dataRoot, directPath),
    };
  }

  const parts = subPath.split('/').filter(Boolean);
  if (parts.length) {
    const directoryParts = parts.slice(0, -1);
    const fileName = parts[parts.length - 1];
    const directoryPath = directoryParts.length
      ? findPathCaseInsensitive(dataRoot, directoryParts)
      : dataRoot;
    if (directoryPath && fs.existsSync(directoryPath)) {
      const match = fs.readdirSync(directoryPath).find((entry) => entry.toLowerCase() === fileName.toLowerCase());
      if (match) {
        const localPath = path.join(directoryPath, match);
        if (fs.statSync(localPath).isFile()) {
          return {
            localPath,
            relativeClassDefinitionPath: toWorkspaceDatasetRelativePath(dataRoot, localPath),
          };
        }
      }
    }
  }

  throw Object.assign(
    new Error(`클래스 정의 txt 파일을 찾을 수 없습니다: ${relativeClassPath}`),
    { statusCode: 404 },
  );
}

function loadClassNamesFromDefinitionPath(relativeClassPath, runtimeConfig) {
  const { localPath, relativeClassDefinitionPath } = resolveLocalClassDefinitionPath(
    relativeClassPath,
    runtimeConfig,
  );
  const classNames = parseClassNamesFromText(fs.readFileSync(localPath, 'utf8'));
  if (!classNames.length) {
    throw new Error('클래스 정의 txt 파일이 비어 있습니다.');
  }
  return { classNames, classSource: localPath, relativeClassDefinitionPath };
}

function listAvailableClassDefinitionFiles(dataRoot) {
  const classFolder = getClassFolderRoot(dataRoot);
  if (classFolder && fs.existsSync(classFolder)) {
    const files = [];
    for (const entry of fs.readdirSync(classFolder, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.txt')) {
        continue;
      }
      const entryPath = path.join(classFolder, entry.name);
      try {
        const classNames = parseClassNamesFromText(fs.readFileSync(entryPath, 'utf8'));
        if (!classNames.length) {
          continue;
        }
        files.push({
          path: toDatasetRelativePath(dataRoot, entryPath),
          name: entry.name,
          classCount: classNames.length,
          classNames,
        });
      } catch {
        // bbox label txt 등은 제외
      }
    }
    if (files.length) {
      return files.sort((left, right) => left.path.localeCompare(right.path, 'ko'));
    }
  }

  const files = [];
  function scanDirectory(directoryPath, depth = 0, maximumDepth = 5) {
    if (depth > maximumDepth || !fs.existsSync(directoryPath)) {
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.txt')) continue;
      try {
        const classNames = parseClassNamesFromText(fs.readFileSync(entryPath, 'utf8'));
        if (!classNames.length) continue;
        files.push({
          path: toWorkspaceDatasetRelativePath(dataRoot, entryPath),
          name: entry.name,
          classCount: classNames.length,
          classNames,
        });
      } catch {
        // bbox label txt 등은 제외
      }
    }
  }

  scanDirectory(dataRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path, 'ko'));
}

function suggestClassDefinitionPath(relativeDatasetPath, dataRoot, availableFiles = []) {
  const folderName = extractDatasetFolderName(relativeDatasetPath);
  const preferredPaths = [
    resolveClassDefinitionPath(dataRoot, relativeDatasetPath),
    `dataset/class_folder/${folderName}.txt`,
    `dataset/class_folder/${folderName.toLowerCase()}.txt`,
    `dataset/${folderName}/classes.txt`,
  ].filter(Boolean);

  for (const candidate of preferredPaths) {
    const match = availableFiles.find((item) => item.path.toLowerCase() === candidate.toLowerCase());
    if (match) return match.path;
  }

  const fuzzy = availableFiles.find((item) => item.name.toLowerCase() === `${folderName.toLowerCase()}.txt`);
  if (fuzzy) return fuzzy.path;

  return '';
}

function discoverClassNamesForTraining(
  localDatasetPath,
  dataRoot,
  relativeClassDefinitionPath = '',
  classDefinitionText = '',
) {
  const inlineText = String(classDefinitionText || '').trim();
  if (inlineText) {
    const classNames = parseClassNamesFromText(inlineText);
    if (!classNames.length) {
      throw new Error('클래스 정의 txt 내용이 비어 있거나 유효한 클래스명이 없습니다.');
    }
    return {
      classNames,
      classSource: 'inline-text',
      relativeClassDefinitionPath: '',
    };
  }
  if (relativeClassDefinitionPath) {
    return loadClassNamesFromDefinitionPath(relativeClassDefinitionPath, { paths: { dataRoot } });
  }
  const fromDataset = discoverClassNames(localDatasetPath, '', dataRoot);
  if (fromDataset.length) {
    return { classNames: fromDataset, classSource: path.join(localDatasetPath, 'classes.txt') };
  }

  const folderName = path.basename(localDatasetPath);
  const classFile = resolveClassDefinitionFile(dataRoot, folderName);
  const candidates = [
    classFile,
    path.join(dataRoot, 'classes.txt'),
    path.join(localDatasetPath, 'classes.txt'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      const classNames = parseClassNamesFromText(fs.readFileSync(candidate, 'utf8'));
      if (classNames.length) {
        return { classNames, classSource: candidate };
      }
    } catch {
      // try next candidate
    }
  }

  return { classNames: [], classSource: null };
}

function countLabelsRecursively(rootPath, maximumFiles = 5000) {
  let labelCount = 0;
  let imageCount = 0;
  const stack = [rootPath];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(extension)) {
        imageCount += 1;
      } else if (extension === '.txt' && entry.name.toLowerCase() !== 'classes.txt') {
        labelCount += 1;
      }
      if (imageCount + labelCount >= maximumFiles) {
        return { imageCount, labelCount, truncated: true };
      }
    }
  }
  return { imageCount, labelCount, truncated: false };
}

function scanFolderLabelStats(rootPath, maximumEntries = 2000, maximumLabelSamples = 500) {
  let labelCount = 0;
  let imageCount = 0;
  const classIds = new Set();
  let sampledLabels = 0;
  const stack = [rootPath];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(extension)) {
        imageCount += 1;
      } else if (extension === '.txt' && entry.name.toLowerCase() !== 'classes.txt') {
        labelCount += 1;
        if (sampledLabels < maximumLabelSamples) {
          sampledLabels += 1;
          try {
            const lines = fs.readFileSync(entryPath, 'utf8').split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) continue;
              const classId = Number.parseInt(trimmed.split(/\s+/)[0], 10);
              if (Number.isFinite(classId) && classId >= 0) {
                classIds.add(classId);
              }
            }
          } catch {
            // ignore unreadable label file
          }
        }
      }
      if (imageCount + labelCount >= maximumEntries) {
        return {
          imageCount,
          labelCount,
          appliedLabelIds: [...classIds].sort((left, right) => left - right),
          truncated: true,
        };
      }
    }
  }
  return {
    imageCount,
    labelCount,
    appliedLabelIds: [...classIds].sort((left, right) => left - right),
    truncated: false,
  };
}

function resolveDatasetFolderClassSummary(localDatasetPath, dataRoot, relativeDatasetPath, classFiles = []) {
  const suggestedClassPath = suggestClassDefinitionPath(relativeDatasetPath, dataRoot, classFiles);
  const stats = scanFolderLabelStats(localDatasetPath);
  const classNames = suggestedClassPath
    ? (classFiles.find((item) => item.path === suggestedClassPath)?.classNames || [])
    : [];

  return {
    classCount: classNames.length || (stats.appliedLabelIds.length ? Math.max(...stats.appliedLabelIds) + 1 : 0),
    classDefinitionPath: suggestedClassPath,
    classNames,
    appliedLabelIds: stats.appliedLabelIds,
    imageCount: stats.imageCount,
    labelCount: stats.labelCount,
    hasClasses: classNames.length > 0 || stats.appliedLabelIds.length > 0,
  };
}

function formatYamlValue(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatYamlValue(item)).join(', ')}]`;
  }
  const text = String(value);
  if (/^[a-zA-Z0-9._/-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function buildDataYamlString(config) {
  const lines = [
    '# Ultralytics YOLO dataset config (generated by Intellivix MLOps)',
    `path: ${formatYamlValue(config.path)}`,
    `train: ${formatYamlValue(config.train)}`,
    `val: ${formatYamlValue(config.val)}`,
    `nc: ${config.nc}`,
    'names:',
  ];
  config.names.forEach((name, index) => {
    lines.push(`  ${index}: ${formatYamlValue(name)}`);
  });
  return `${lines.join('\n')}\n`;
}

class DatasetConfigService {
  constructor(runtimeConfig) {
    this.config = runtimeConfig;
    this.datasetSuggestionsCache = null;
  }

  buildPreview(input = {}) {
    const workspaceRoot = getTrainingWorkspaceRoot(this.config);
    const datasetPaths = normalizeDatasetPaths(input);
    if (!datasetPaths.length) {
      throw new Error('학습 데이터셋 경로를 하나 이상 선택하세요.');
    }
    const relativeConfigPath = input.datasetConfigPath
      ? assertRelativeTrainingPath(input.datasetConfigPath, '데이터셋 설정 파일')
      : path.posix.join(
        String(this.config.training?.configsRoot || 'detector/configs').replace(/^\/+/, ''),
        'data.yaml',
      );

    const scanResults = resolveMultipleLocalDatasetScanPaths(datasetPaths, this.config);
    const localDatasetPath = scanResults[0].localPath;
    const resolvedRelativeDatasetPath = datasetPaths.join(', ');

    const classDefinitionText = String(input.classDefinitionText || '').trim();
    const requestedClassPath = !classDefinitionText && input.classDefinitionPath
      ? String(input.classDefinitionPath).trim()
      : '';
    const { classNames, classSource, relativeClassDefinitionPath } = discoverClassNamesForMultipleDatasets(
      scanResults,
      this.config.paths.dataRoot,
      requestedClassPath,
      classDefinitionText,
    );
    if (!classNames.length) {
      throw new Error(
        '클래스 정의 txt를 붙여넣거나 로컬 파일을 불러오세요. YAML names 항목은 이 내용으로 생성됩니다.',
      );
    }

    const counts = scanResults.length > 1
      ? countLabelsFromMultiplePaths(scanResults.map((item) => item.localPath))
      : countLabelsRecursively(localDatasetPath);
    const absoluteDatasetPath = resolveTrainingServerPath(
      resolvedRelativeDatasetPath,
      workspaceRoot,
      '학습 데이터셋 경로',
    );
    const absoluteConfigPath = resolveTrainingServerPath(
      relativeConfigPath,
      workspaceRoot,
      '데이터셋 설정 파일',
    );

    const { detectExistingSplitForModel, resolveSplitListPaths, countLinesInFile, usesWorkspaceRelativeLists, resolveListFileAbsolutePath, suggestSplitPathsForModel } = require('./dataset-split-service');
    const modelName = String(input.name || '').trim();
    const existingSplit = modelName ? detectExistingSplitForModel(modelName, this.config) : null;
    const splitPaths = resolveSplitListPaths(
      input.trainPath || existingSplit?.trainPath || (modelName ? suggestSplitPathsForModel(modelName, this.config).trainPath : '.'),
      input.valPath || existingSplit?.valPath || (modelName ? suggestSplitPathsForModel(modelName, this.config).valPath : '.'),
    );
    const yamlDatasetRoot = usesWorkspaceRelativeLists(splitPaths.trainPath)
      ? workspaceRoot
      : absoluteDatasetPath;
    const yamlConfig = {
      path: yamlDatasetRoot,
      train: splitPaths.trainPath,
      val: splitPaths.valPath,
      nc: classNames.length,
      names: classNames,
    };

    const warnings = [];
    if (counts.truncated) {
      warnings.push('데이터셋 파일 수가 많아 일부만 검사했습니다.');
    }
    if (counts.imageCount === 0) {
      warnings.push('이미지 파일(.jpg/.jpeg)을 찾지 못했습니다.');
    }
    if (counts.labelCount === 0) {
      warnings.push('라벨 txt 파일을 찾지 못했습니다.');
    }
    if (counts.imageCount > counts.labelCount) {
      warnings.push(`라벨 없는 이미지가 있을 수 있습니다. (이미지 ${counts.imageCount}, 라벨 ${counts.labelCount})`);
    }

    const trainListCount = splitPaths.trainPath.endsWith('.txt')
      ? countLinesInFile(resolveListFileAbsolutePath(splitPaths.trainPath, this.config, localDatasetPath))
      : null;
    const valListCount = splitPaths.valPath.endsWith('.txt')
      ? countLinesInFile(resolveListFileAbsolutePath(splitPaths.valPath, this.config, localDatasetPath))
      : null;
    if (trainListCount === 0) {
      warnings.push('train 경로 목록이 비어 있습니다.');
    }
    if (valListCount === 0 && splitPaths.valPath !== splitPaths.trainPath) {
      warnings.push('val 경로 목록이 비어 있습니다.');
    }

    return {
      relativeDatasetPath: resolvedRelativeDatasetPath,
      datasetPaths,
      requestedDatasetPath: datasetPaths.join(', '),
      trainPath: splitPaths.trainPath,
      valPath: splitPaths.valPath,
      modelFolderName: existingSplit?.modelFolderName || null,
      relativeClassDefinitionPath,
      requestedClassDefinitionPath: requestedClassPath || null,
      classDefinitionText: classDefinitionText || null,
      classDefinitionSource: classSource === 'inline-text' ? 'inline-text' : 'file',
      relativeConfigPath,
      absoluteDatasetPath,
      absoluteConfigPath,
      workspaceRoot,
      classNames,
      classSource,
      imageCount: counts.imageCount,
      labelCount: counts.labelCount,
      trainListCount,
      valListCount,
      yaml: buildDataYamlString(yamlConfig),
      yamlConfig,
      warnings,
      note: usesWorkspaceRelativeLists(splitPaths.trainPath)
        ? 'path는 workspace root이며 train/valid는 detector/data/{학습명}/ 목록을 참조합니다.'
        : '학습 실행 시 이 yaml이 detector/configs/data.yaml 로 저장됩니다.',
    };
  }

  createDatasetSplit(input = {}) {
    const { createDatasetSplit } = require('./dataset-split-service');
    return createDatasetSplit(input, this.config);
  }

  suggestSplitPaths(relativeDatasetPath, modelName = '') {
    const { suggestSplitPathsForModel } = require('./dataset-split-service');
    const split = suggestSplitPathsForModel(modelName, this.config);
    return {
      trainPath: split.trainPath,
      valPath: split.valPath,
      modelFolderName: split.modelFolderName,
      trainCount: split.trainCount,
      valCount: split.valCount,
      exists: split.exists,
    };
  }

  listClassDefinitionFiles(options = {}) {
    const dataRoot = this.config.paths.dataRoot;
    if (!fs.existsSync(dataRoot)) {
      return { files: [], suggestedPath: '', suggestedContent: '' };
    }
    const files = listAvailableClassDefinitionFiles(dataRoot);
    const datasetPath = options.datasetPath
      || this.config.training?.datasetPath
      || 'dataset/Images/Integrated';
    const suggestedPath = suggestClassDefinitionPath(datasetPath, dataRoot, files);
    let suggestedContent = '';
    if (suggestedPath) {
      try {
        const { localPath } = resolveLocalClassDefinitionPath(suggestedPath, this.config);
        suggestedContent = fs.readFileSync(localPath, 'utf8').trim();
      } catch {
        suggestedContent = '';
      }
    }
    return { files, suggestedPath, suggestedContent, datasetPath };
  }

  suggestDatasetPath(requestOptions = {}) {
    const refresh = requestOptions.refresh === true;
    const dataRoot = this.config.paths.dataRoot;
    if (!fs.existsSync(dataRoot)) {
      return {
        datasetPath: this.config.training?.datasetPath || 'dataset/Images/Integrated',
        classDefinitionPath: '',
        options: [],
        classFiles: [],
      };
    }

    const cacheKey = dataRoot;
    if (!refresh
      && this.datasetSuggestionsCache
      && this.datasetSuggestionsCache.key === cacheKey
      && Date.now() - this.datasetSuggestionsCache.at < 60000) {
      return this.datasetSuggestionsCache.value;
    }

    const classFiles = listAvailableClassDefinitionFiles(dataRoot);
    const imageFolders = listImageDatasetFolders(dataRoot);
    const folderEntries = imageFolders.length
      ? imageFolders
      : fs.readdirSync(dataRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory()
          && !entry.name.startsWith('.')
          && !isReservedDatasetRootName(entry.name))
        .map((entry) => ({
          name: entry.name,
          localPath: path.join(dataRoot, entry.name),
          datasetPath: toDatasetRelativePath(dataRoot, path.join(dataRoot, entry.name)),
        }));
    const folderOptions = folderEntries
      .map((folder) => {
        const suggestedClassPath = suggestClassDefinitionPath(folder.datasetPath, dataRoot, classFiles);
        const classSummary = resolveDatasetFolderClassSummary(
          folder.localPath,
          dataRoot,
          folder.datasetPath,
          classFiles,
        );
        return {
          datasetPath: folder.datasetPath,
          classDefinitionPath: suggestedClassPath || classSummary.classDefinitionPath || '',
          classCount: classSummary.classCount,
          classNames: classSummary.classNames,
          appliedLabelIds: classSummary.appliedLabelIds,
          imageCount: classSummary.imageCount,
          labelCount: classSummary.labelCount,
          hasClasses: classSummary.hasClasses,
        };
      })
      .sort((left, right) => Number(right.hasClasses) - Number(left.hasClasses)
        || right.imageCount - left.imageCount
        || left.datasetPath.localeCompare(right.datasetPath, 'ko'));

    const preferred = folderOptions.find((item) => item.hasClasses && item.imageCount > 0)
      || folderOptions.find((item) => item.hasClasses)
      || folderOptions[0];

    const preferredDatasetPath = preferred?.datasetPath
      || this.config.training?.datasetPath
      || (usesImagesLayout(dataRoot) ? 'dataset/Images/Integrated' : 'dataset/Integrated');
    const defaultModelName = String(this.config.training?.defaultSplitModelName || 'Detector_YOLO_Training');
    const split = this.suggestSplitPaths(preferredDatasetPath, defaultModelName);

    const value = {
      datasetPath: preferredDatasetPath,
      classDefinitionPath: preferred?.classDefinitionPath
        || suggestClassDefinitionPath(preferred?.datasetPath, dataRoot, classFiles),
      trainPath: split.trainPath,
      valPath: split.valPath,
      modelFolderName: split.modelFolderName,
      splitSummary: split.exists
        ? `기존 split (train ${split.trainCount}, valid ${split.valCount})`
        : '',
      options: folderOptions,
      classFiles,
    };
    this.datasetSuggestionsCache = { key: cacheKey, at: Date.now(), value };
    return value;
  }
}

module.exports = {
  DatasetConfigService,
  buildDataYamlString,
  normalizeDatasetPaths,
  resolveLocalDatasetScanPath,
  resolveMultipleLocalDatasetScanPaths,
  resolveLocalClassDefinitionPath,
  listAvailableClassDefinitionFiles,
};