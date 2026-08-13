'use strict';

const fs = require('fs');
const path = require('path');
const { listImagesRecursively } = require('./file-system-inspection-service');
const {
  extractDatasetFolderName,
  inferDataRootFromImageDirectory,
  resolveClassDefinitionFile,
} = require('../utils/dataset-layout');

const TAGGING_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg']);

function joinMirroredLabelPath(labelRoot, imageDirectory, imagePath, fileName) {
  let relativePath = path.relative(imageDirectory, imagePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    relativePath = path.basename(imagePath);
  }
  const relativeDir = path.dirname(relativePath);
  if (!relativeDir || relativeDir === '.') {
    return path.join(labelRoot, fileName);
  }
  return path.join(labelRoot, relativeDir, fileName);
}

function resolveLabelFilePath(imagePath, options = {}) {
  const fileName = `${path.parse(imagePath).name}.txt`;

  if (options.saveBesideImage) {
    return path.join(path.dirname(imagePath), fileName);
  }

  const imageDirectory = options.imageDirectory || path.dirname(imagePath);
  const labelRoot = String(options.labelDirectory || options.labelRoot || '').trim()
    || path.join(imageDirectory, 'labels');

  return joinMirroredLabelPath(labelRoot, imageDirectory, imagePath, fileName);
}

function labelFilePathForImage(imagePath, labelDirectory, imageDirectory = path.dirname(imagePath)) {
  return resolveLabelFilePath(imagePath, {
    imageDirectory,
    labelDirectory,
  });
}

function readLabelFile(labelPath) {
  if (!fs.existsSync(labelPath)) {
    return { labelPath, labels: [] };
  }
  return {
    labelPath,
    labels: parseYoloLabelText(fs.readFileSync(labelPath, 'utf8')),
  };
}

function parseYoloLabelText(text) {
  if (!text.trim()) {
    return [];
  }
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const tokens = line.split(/\s+/);
      if (tokens.length !== 5) {
        throw new Error(`${index + 1}번째 라벨 줄의 값이 5개가 아닙니다.`);
      }
      const [classIdText, xText, yText, widthText, heightText] = tokens;
      const values = [xText, yText, widthText, heightText].map(Number);
      if (!Number.isInteger(Number(classIdText)) || values.some((value) => !Number.isFinite(value))) {
        throw new Error(`${index + 1}번째 라벨 줄에 숫자가 아닌 값이 있습니다.`);
      }
      if (values.some((value) => value < 0 || value > 1)) {
        throw new Error(`${index + 1}번째 라벨 좌표가 0과 1 사이가 아닙니다.`);
      }
      return {
        classId: Number(classIdText),
        xCenter: values[0],
        yCenter: values[1],
        width: values[2],
        height: values[3],
      };
    });
}

function loadLabels(imagePath, imageDirectory, labelDirectory = '', options = {}) {
  if (options.saveBesideImage) {
    return readLabelFile(resolveLabelFilePath(imagePath, { saveBesideImage: true }));
  }

  const mirroredPath = resolveLabelFilePath(imagePath, { imageDirectory, labelDirectory });
  const besidePath = resolveLabelFilePath(imagePath, { saveBesideImage: true });
  for (const labelPath of [...new Set([mirroredPath, besidePath])]) {
    if (fs.existsSync(labelPath)) {
      return readLabelFile(labelPath);
    }
  }
  return { labelPath: mirroredPath, labels: [] };
}

function validateLabel(label, index) {
  const classId = Number(label.classId);
  const coordinates = [label.xCenter, label.yCenter, label.width, label.height].map(Number);
  if (!Number.isInteger(classId) || classId < 0) {
    throw new Error(`${index + 1}번째 Bounding Box의 classId가 올바르지 않습니다.`);
  }
  if (coordinates.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(`${index + 1}번째 Bounding Box 좌표가 0과 1 사이가 아닙니다.`);
  }
  return { classId, coordinates };
}

function saveLabels(imagePath, imageDirectory, labelDirectory, labels, options = {}) {
  const labelPath = resolveLabelFilePath(imagePath, {
    imageDirectory,
    labelDirectory,
    saveBesideImage: options.saveBesideImage,
  });
  fs.mkdirSync(path.dirname(labelPath), { recursive: true });
  const lines = labels.map((label, index) => {
    const { classId, coordinates } = validateLabel(label, index);
    return [classId, ...coordinates.map((value) => value.toFixed(6))].join(' ');
  });
  const temporaryPath = `${labelPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  fs.renameSync(temporaryPath, labelPath);
  return labelPath;
}

function resolveLabelDirectory(imageDirectory, labelDirectory = '') {
  const explicit = String(labelDirectory || '').trim();
  if (explicit) {
    return explicit;
  }
  return path.join(imageDirectory, 'labels');
}

function parseClassNamesFromText(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    throw new Error('클래스 파일이 비어 있습니다.');
  }
  const classNames = [];
  lines.forEach((line, index) => {
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length === 5 && tokens.slice(1).every((token) => Number.isFinite(Number(token)))) {
      throw new Error(`${index + 1}번째 줄은 Bounding Box 라벨 형식입니다. person, ncar 형식의 클래스 목록 파일을 선택하세요.`);
    }
    classNames.push(tokens.length === 1 ? tokens[0] : line);
  });
  return classNames;
}

function loadClassNamesFromText(text, fileName = 'classes.txt') {
  const classNames = parseClassNamesFromText(text);
  return {
    path: fileName,
    fileName,
    classNames,
    classes: buildClassCatalog(classNames),
    source: 'inline-text',
  };
}

function loadClassNamesFromFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`클래스 파일을 찾을 수 없습니다: ${filePath}`);
  }
  const classNames = parseClassNamesFromText(fs.readFileSync(filePath, 'utf8'));
  return {
    path: filePath,
    fileName: path.basename(filePath),
    classNames,
    classes: buildClassCatalog(classNames),
    source: 'server-file',
  };
}

function looksLikeClassDefinitionFile(filePath) {
  try {
    loadClassNamesFromFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function listDirectoryEntries(directoryPath) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    throw new Error(`폴더가 존재하지 않습니다: ${directoryPath}`);
  }
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) {
      continue;
    }
    directories.push({ name: entry.name, path: path.join(directoryPath, entry.name) });
  }
  directories.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  return directories;
}

function listFolderBrowser(directoryPath) {
  const directories = listDirectoryEntries(directoryPath);
  return {
    currentPath: directoryPath,
    parentPath: path.dirname(directoryPath),
    directories,
  };
}

function listClassFileBrowser(directoryPath) {
  const directories = listDirectoryEntries(directoryPath);
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || !entry.isFile() || !entry.name.toLowerCase().endsWith('.txt')) {
      continue;
    }
    const entryPath = path.join(directoryPath, entry.name);
    files.push({
      name: entry.name,
      path: entryPath,
      isClassDefinition: looksLikeClassDefinitionFile(entryPath),
    });
  }
  files.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  return {
    currentPath: directoryPath,
    parentPath: path.dirname(directoryPath),
    directories,
    files,
  };
}

function discoverClassNames(imageDirectory, labelDirectory, dataRoot = '') {
  const resolvedDataRoot = inferDataRootFromImageDirectory(imageDirectory, dataRoot);
  const folderName = path.basename(imageDirectory);
  const classFile = resolveClassDefinitionFile(resolvedDataRoot, folderName);
  if (classFile && fs.existsSync(classFile)) {
    return parseClassNamesFromText(fs.readFileSync(classFile, 'utf8'));
  }

  const candidates = [
    path.join(imageDirectory, 'classes.txt'),
  ];
  if (labelDirectory) {
    candidates.unshift(path.join(labelDirectory, 'classes.txt'));
  }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    return fs.readFileSync(candidate, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

function buildClassCatalog(classNames, labelSamples = []) {
  const maxClassId = Math.max(
    classNames.length - 1,
    ...labelSamples.flatMap((labels) => labels.map((label) => label.classId)),
    -1,
  );
  const classes = [];
  for (let classId = 0; classId <= maxClassId; classId += 1) {
    classes.push({
      id: classId,
      name: classNames[classId] || `class ${classId}`,
    });
  }
  return classes;
}

function buildTaggingWorkspace(imageDirectory, dataRoot = '') {
  const resolvedDataRoot = inferDataRootFromImageDirectory(imageDirectory, dataRoot);
  const classNames = discoverClassNames(imageDirectory, '', resolvedDataRoot);
  const imagePaths = listImagesRecursively(imageDirectory, 5000, TAGGING_IMAGE_EXTENSIONS);
  const images = imagePaths.map((imagePath) => {
    const labelInfo = loadLabels(imagePath, imageDirectory, '', { saveBesideImage: true });
    return {
      name: path.basename(imagePath),
      relativePath: path.relative(imageDirectory, imagePath),
      path: imagePath,
      imageUrl: `/api/data/image?path=${encodeURIComponent(imagePath)}`,
      hasLabel: labelInfo.labels.length > 0,
      labelCount: labelInfo.labels.length,
      labelPath: labelInfo.labelPath,
      classIds: [...new Set(labelInfo.labels.map((label) => label.classId))],
    };
  });
  const classes = buildClassCatalog(classNames, imagePaths.map((imagePath) => loadLabels(imagePath, imageDirectory, '', { saveBesideImage: true }).labels));
  return {
    imageDirectory,
    saveBesideImage: true,
    classes,
    images,
    summary: {
      totalImages: images.length,
      labeledImages: images.filter((image) => image.hasLabel).length,
      unlabeledImages: images.filter((image) => !image.hasLabel).length,
    },
  };
}

module.exports = {
  buildTaggingWorkspace,
  discoverClassNames,
  labelFilePathForImage,
  listClassFileBrowser,
  listFolderBrowser,
  loadClassNamesFromFile,
  loadClassNamesFromText,
  loadLabels,
  parseClassNamesFromText,
  parseYoloLabelText,
  resolveLabelFilePath,
  resolveLabelDirectory,
  saveLabels,
};
