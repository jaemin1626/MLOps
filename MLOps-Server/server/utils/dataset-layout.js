'use strict';

const fs = require('fs');
const path = require('path');

const CLASS_FOLDER_NAME = 'class_folder';
const IMAGES_FOLDER_NAME = 'Images';
const DETECTOR_FOLDER_NAME = 'detector';
const VLM_FOLDER_NAME = 'vlm';
const VLM_TOPIC_IMAGES_FOLDER = 'Images';
const VLM_LABEL_FOLDER_NAME = 'label';
const LEGACY_VLM_IMAGES_FOLDER = 'images';
const LEGACY_VLM_JSON_FOLDER = 'json';
const VLM_MASTER_JSON_FILE = 'conversations.json';
const RESERVED_ROOT_DIR_NAMES = new Set([
  CLASS_FOLDER_NAME.toLowerCase(),
  IMAGES_FOLDER_NAME.toLowerCase(),
  DETECTOR_FOLDER_NAME.toLowerCase(),
  VLM_FOLDER_NAME.toLowerCase(),
  LEGACY_VLM_IMAGES_FOLDER,
  LEGACY_VLM_JSON_FOLDER,
  VLM_LABEL_FOLDER_NAME,
  'labels',
]);

function findChildDirectoryCaseInsensitive(parentPath, childName) {
  if (!parentPath || !fs.existsSync(parentPath)) {
    return null;
  }
  const exact = path.join(parentPath, childName);
  if (fs.existsSync(exact)) {
    return exact;
  }
  const match = fs.readdirSync(parentPath).find((entry) => entry.toLowerCase() === childName.toLowerCase());
  return match ? path.join(parentPath, match) : null;
}

function getDetectorRoot(dataRoot) {
  return findChildDirectoryCaseInsensitive(dataRoot, DETECTOR_FOLDER_NAME);
}

function getVlmRoot(dataRoot) {
  return findChildDirectoryCaseInsensitive(dataRoot, VLM_FOLDER_NAME);
}

function getClassFolderRoot(dataRoot) {
  const detectorRoot = getDetectorRoot(dataRoot);
  if (detectorRoot) {
    const detectorClassFolder = findChildDirectoryCaseInsensitive(detectorRoot, CLASS_FOLDER_NAME);
    if (detectorClassFolder) {
      return detectorClassFolder;
    }
  }
  return findChildDirectoryCaseInsensitive(dataRoot, CLASS_FOLDER_NAME);
}

function getImagesRoot(dataRoot) {
  const detectorRoot = getDetectorRoot(dataRoot);
  if (detectorRoot) {
    const detectorImages = findChildDirectoryCaseInsensitive(detectorRoot, IMAGES_FOLDER_NAME);
    if (detectorImages) {
      return detectorImages;
    }
  }
  return findChildDirectoryCaseInsensitive(dataRoot, IMAGES_FOLDER_NAME);
}

function getVlmTopicImagesDir(topicRoot) {
  return findChildDirectoryCaseInsensitive(topicRoot, VLM_TOPIC_IMAGES_FOLDER)
    || findChildDirectoryCaseInsensitive(topicRoot, LEGACY_VLM_IMAGES_FOLDER);
}

function getVlmTopicLabelDir(topicRoot) {
  return findChildDirectoryCaseInsensitive(topicRoot, VLM_LABEL_FOLDER_NAME)
    || findChildDirectoryCaseInsensitive(topicRoot, LEGACY_VLM_JSON_FOLDER);
}

function isVlmTopicRoot(topicRoot) {
  return Boolean(getVlmTopicImagesDir(topicRoot) || getVlmTopicLabelDir(topicRoot));
}

function getLegacyVlmImagesRoot(dataRoot) {
  const vlmRoot = getVlmRoot(dataRoot);
  return vlmRoot
    ? findChildDirectoryCaseInsensitive(vlmRoot, LEGACY_VLM_IMAGES_FOLDER)
    : null;
}

function getLegacyVlmJsonRoot(dataRoot) {
  const vlmRoot = getVlmRoot(dataRoot);
  return vlmRoot
    ? findChildDirectoryCaseInsensitive(vlmRoot, LEGACY_VLM_JSON_FOLDER)
    : null;
}

function getVlmImagesRoot(dataRoot) {
  const topic = resolveDefaultVlmTopic(dataRoot);
  if (topic?.imagesDir) {
    return topic.imagesDir;
  }
  return getLegacyVlmImagesRoot(dataRoot);
}

function getVlmJsonRoot(dataRoot) {
  const topic = resolveDefaultVlmTopic(dataRoot);
  if (topic?.labelDir) {
    return topic.labelDir;
  }
  return getLegacyVlmJsonRoot(dataRoot);
}

function getEventFoldersRoot(dataRoot) {
  return getImagesRoot(dataRoot) || dataRoot;
}

function usesImagesLayout(dataRoot) {
  return Boolean(getImagesRoot(dataRoot));
}

function usesDetectorLayout(dataRoot) {
  return Boolean(getDetectorRoot(dataRoot) && getImagesRoot(dataRoot));
}

function usesVlmLayout(dataRoot) {
  return listVlmTopicFolders(dataRoot).length > 0;
}

function isReservedDatasetRootName(name) {
  return RESERVED_ROOT_DIR_NAMES.has(String(name || '').toLowerCase());
}

function toDatasetRelativePath(dataRoot, absolutePath) {
  const relative = path.relative(dataRoot, absolutePath).split(path.sep).join('/');
  return relative ? `dataset/${relative}` : 'dataset';
}

function extractDatasetFolderName(relativeDatasetPath) {
  const normalized = String(relativeDatasetPath || '').replace(/^dataset\//, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === DETECTOR_FOLDER_NAME.toLowerCase()
    && parts[1]?.toLowerCase() === IMAGES_FOLDER_NAME.toLowerCase()
    && parts[2]) {
    return parts[2];
  }
  if (parts[0]?.toLowerCase() === IMAGES_FOLDER_NAME.toLowerCase() && parts[1]) {
    return parts[1];
  }
  if (parts[0]?.toLowerCase() === VLM_FOLDER_NAME.toLowerCase() && parts[1]) {
    return parts[1];
  }
  return parts[parts.length - 1] || '';
}

function countDetectorDatasetFolders(dataRoot) {
  return listImageDatasetFolders(dataRoot).length;
}

function countVlmDatasetFolders(dataRoot) {
  return listVlmTopicFolders(dataRoot).filter((topic) => !topic.legacy).length;
}

function resolveVlmLabelFilePath(labelDir, topicName = '') {
  if (!labelDir) {
    return path.join('', VLM_MASTER_JSON_FILE);
  }
  if (!fs.existsSync(labelDir)) {
    return path.join(labelDir, VLM_MASTER_JSON_FILE);
  }

  const preferred = [
    path.join(labelDir, VLM_MASTER_JSON_FILE),
    topicName ? path.join(labelDir, `${topicName}.json`) : null,
  ].filter(Boolean);

  for (const filePath of preferred) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  const jsonFiles = fs.readdirSync(labelDir)
    .filter((entry) => entry.toLowerCase().endsWith('.json'))
    .map((entry) => path.join(labelDir, entry));
  if (jsonFiles.length === 1) {
    return jsonFiles[0];
  }
  if (topicName) {
    const matched = jsonFiles.find((filePath) => path.basename(filePath).toLowerCase().includes(topicName.toLowerCase()));
    if (matched) {
      return matched;
    }
  }
  return path.join(labelDir, VLM_MASTER_JSON_FILE);
}

const vlmRecordCountCache = new Map();

function countVlmRecordsByIndexPattern(labelFile) {
  const chunkSize = 4 * 1024 * 1024;
  const fd = fs.openSync(labelFile, 'r');
  try {
    const stat = fs.statSync(labelFile);
    let count = 0;
    let carry = '';
    let position = 0;
    while (position < stat.size) {
      const length = Math.min(chunkSize, stat.size - position);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, position);
      const text = `${carry}${buffer.toString('utf8')}`;
      const matches = text.match(/"index"\s*:/g);
      if (matches) {
        count += matches.length;
      }
      carry = text.slice(-32);
      position += length;
    }
    return count;
  } finally {
    fs.closeSync(fd);
  }
}

function countVlmLabelRecords(labelFile) {
  if (!labelFile || !fs.existsSync(labelFile)) {
    return 0;
  }

  let stat;
  try {
    stat = fs.statSync(labelFile);
  } catch {
    return 0;
  }

  const cacheKey = `${labelFile}|${stat.mtimeMs}|${stat.size}`;
  if (vlmRecordCountCache.has(cacheKey)) {
    return vlmRecordCountCache.get(cacheKey);
  }

  let count = 0;
  try {
    if (stat.size <= 2 * 1024 * 1024) {
      const parsed = JSON.parse(fs.readFileSync(labelFile, 'utf8'));
      count = Array.isArray(parsed) ? parsed.length : 0;
    } else {
      count = countVlmRecordsByIndexPattern(labelFile);
    }
  } catch (_error) {
    count = 0;
  }

  vlmRecordCountCache.set(cacheKey, count);
  if (vlmRecordCountCache.size > 32) {
    const oldestKey = vlmRecordCountCache.keys().next().value;
    vlmRecordCountCache.delete(oldestKey);
  }
  return count;
}

function buildVlmTopicSummary(dataRoot, topicRoot, topicName, options = {}) {
  const imagesDir = getVlmTopicImagesDir(topicRoot);
  const labelDir = getVlmTopicLabelDir(topicRoot);
  const labelFile = labelDir ? resolveVlmLabelFilePath(labelDir, topicName) : null;
  return {
    name: topicName,
    legacy: Boolean(options.legacy),
    topicRoot,
    imagesDir,
    labelDir,
    labelFile,
    datasetPath: toDatasetRelativePath(dataRoot, topicRoot),
    imagesDatasetPath: imagesDir ? toDatasetRelativePath(dataRoot, imagesDir) : '',
    labelDatasetPath: labelDir ? toDatasetRelativePath(dataRoot, labelDir) : '',
    labelFileDatasetPath: labelFile ? toDatasetRelativePath(dataRoot, labelFile) : '',
    recordCount: countVlmLabelRecords(labelFile),
  };
}

function listVlmTopicFolders(dataRoot) {
  const vlmRoot = getVlmRoot(dataRoot);
  if (!vlmRoot || !fs.existsSync(vlmRoot)) {
    return [];
  }

  const topics = [];
  for (const entry of fs.readdirSync(vlmRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const lowerName = entry.name.toLowerCase();
    if (lowerName === LEGACY_VLM_IMAGES_FOLDER || lowerName === LEGACY_VLM_JSON_FOLDER) {
      continue;
    }
    const topicRoot = path.join(vlmRoot, entry.name);
    if (!isVlmTopicRoot(topicRoot)) {
      continue;
    }
    topics.push(buildVlmTopicSummary(dataRoot, topicRoot, entry.name));
  }
  topics.sort((left, right) => left.name.localeCompare(right.name, 'ko'));

  const legacyImages = getLegacyVlmImagesRoot(dataRoot);
  if (legacyImages) {
    topics.push(buildVlmTopicSummary(dataRoot, vlmRoot, '(legacy flat layout)', { legacy: true }));
  }

  return topics;
}

function resolveDefaultVlmTopic(dataRoot) {
  const topics = listVlmTopicFolders(dataRoot);
  return topics.find((topic) => !topic.legacy) || topics[0] || null;
}

function inferVlmTopicContext(imageDirectory, dataRoot = '') {
  const resolvedDataRoot = dataRoot
    ? path.resolve(dataRoot)
    : inferDataRootFromImageDirectory(imageDirectory, dataRoot);
  const vlmRoot = getVlmRoot(resolvedDataRoot);
  if (!vlmRoot) {
    return null;
  }

  const normalized = path.resolve(imageDirectory || vlmRoot);
  let current = normalized;
  while (current && current !== path.dirname(current)) {
    if (isVlmTopicRoot(current)) {
      const topicName = path.basename(current);
      const imagesDir = getVlmTopicImagesDir(current);
      const labelDir = getVlmTopicLabelDir(current);
      return {
        dataRoot: resolvedDataRoot,
        topicName,
        topicRoot: current,
        imagesDir,
        labelDir,
        labelFile: labelDir ? resolveVlmLabelFilePath(labelDir, topicName) : null,
        layout: 'topic',
      };
    }

    const imagesParent = path.dirname(current);
    const folderName = path.basename(current).toLowerCase();
    if (folderName === VLM_TOPIC_IMAGES_FOLDER.toLowerCase()
      || folderName === LEGACY_VLM_IMAGES_FOLDER) {
      if (path.resolve(imagesParent) === path.resolve(vlmRoot)) {
        const legacyJson = getLegacyVlmJsonRoot(resolvedDataRoot);
        return {
          dataRoot: resolvedDataRoot,
          topicName: '',
          topicRoot: vlmRoot,
          imagesDir: current,
          labelDir: legacyJson,
          labelFile: legacyJson ? resolveVlmLabelFilePath(legacyJson, 'conversations') : null,
          layout: 'legacy',
        };
      }
      if (isVlmTopicRoot(imagesParent)) {
        const topicName = path.basename(imagesParent);
        const labelDir = getVlmTopicLabelDir(imagesParent);
        return {
          dataRoot: resolvedDataRoot,
          topicName,
          topicRoot: imagesParent,
          imagesDir: current,
          labelDir,
          labelFile: labelDir ? resolveVlmLabelFilePath(labelDir, topicName) : null,
          layout: 'topic',
        };
      }
    }
    current = path.dirname(current);
  }

  const legacyImages = getLegacyVlmImagesRoot(resolvedDataRoot);
  if (legacyImages && normalized.startsWith(legacyImages)) {
    const legacyJson = getLegacyVlmJsonRoot(resolvedDataRoot);
    return {
      dataRoot: resolvedDataRoot,
      topicName: '',
      topicRoot: vlmRoot,
      imagesDir: legacyImages,
      labelDir: legacyJson,
      labelFile: legacyJson ? resolveVlmLabelFilePath(legacyJson, 'conversations') : null,
      layout: 'legacy',
    };
  }

  const defaultTopic = resolveDefaultVlmTopic(resolvedDataRoot);
  if (defaultTopic) {
    return {
      dataRoot: resolvedDataRoot,
      topicName: defaultTopic.name,
      topicRoot: defaultTopic.topicRoot,
      imagesDir: defaultTopic.imagesDir,
      labelDir: defaultTopic.labelDir,
      labelFile: defaultTopic.labelFile,
      layout: defaultTopic.legacy ? 'legacy' : 'topic',
    };
  }

  return null;
}

function getBrowsableImageRoots(dataRoot) {
  const roots = [];
  const imagesRoot = getImagesRoot(dataRoot);
  if (imagesRoot) {
    roots.push({
      kind: 'detector',
      containerPath: getDetectorRoot(dataRoot) || path.dirname(imagesRoot),
      imagesRoot,
      displayPrefix: `${DETECTOR_FOLDER_NAME}/${IMAGES_FOLDER_NAME}`,
    });
  }

  const vlmRoot = getVlmRoot(dataRoot);
  if (vlmRoot) {
    for (const topic of listVlmTopicFolders(dataRoot)) {
      if (!topic.imagesDir) {
        continue;
      }
      roots.push({
        kind: 'vlm',
        containerPath: topic.legacy ? vlmRoot : topic.topicRoot,
        imagesRoot: topic.imagesDir,
        displayPrefix: topic.legacy
          ? `${VLM_FOLDER_NAME}/${LEGACY_VLM_IMAGES_FOLDER}`
          : `${VLM_FOLDER_NAME}/${topic.name}/${VLM_TOPIC_IMAGES_FOLDER}`,
        topicName: topic.name,
        legacy: Boolean(topic.legacy),
      });
    }
  }

  return roots;
}

function listImageDatasetFolders(dataRoot) {
  const eventRoot = getEventFoldersRoot(dataRoot);
  if (!fs.existsSync(eventRoot)) {
    return [];
  }
  return fs.readdirSync(eventRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      && !entry.name.startsWith('.')
      && !isReservedDatasetRootName(entry.name))
    .map((entry) => {
      const localPath = path.join(eventRoot, entry.name);
      return {
        name: entry.name,
        localPath,
        datasetPath: toDatasetRelativePath(dataRoot, localPath),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}

function resolveClassDefinitionFile(dataRoot, datasetFolderName) {
  const classFolder = getClassFolderRoot(dataRoot);
  const folderName = String(datasetFolderName || '').trim();
  if (!classFolder || !folderName) {
    return null;
  }

  const preferredNames = [
    `${folderName}.txt`,
    `${folderName.toLowerCase()}.txt`,
  ];
  for (const fileName of preferredNames) {
    const exact = path.join(classFolder, fileName);
    if (fs.existsSync(exact)) {
      return exact;
    }
  }

  for (const entry of fs.readdirSync(classFolder)) {
    if (!entry.toLowerCase().endsWith('.txt')) {
      continue;
    }
    if (path.parse(entry).name.toLowerCase() === folderName.toLowerCase()) {
      return path.join(classFolder, entry);
    }
  }
  return null;
}

function resolveClassDefinitionPath(dataRoot, relativeDatasetPath) {
  const classFile = resolveClassDefinitionFile(dataRoot, extractDatasetFolderName(relativeDatasetPath));
  return classFile ? toDatasetRelativePath(dataRoot, classFile) : '';
}

function inferDataRootFromImageDirectory(imageDirectory, configuredDataRoot = '') {
  const normalizedImageDirectory = path.resolve(imageDirectory);
  const normalizedConfiguredRoot = configuredDataRoot ? path.resolve(configuredDataRoot) : '';

  if (normalizedConfiguredRoot && normalizedImageDirectory.startsWith(normalizedConfiguredRoot)) {
    return normalizedConfiguredRoot;
  }

  let current = normalizedImageDirectory;
  while (current && current !== path.dirname(current)) {
    if (getClassFolderRoot(current)
      || getImagesRoot(current)
      || getVlmRoot(current)) {
      return normalizedConfiguredRoot || current;
    }
    current = path.dirname(current);
  }
  return normalizedConfiguredRoot || normalizedImageDirectory;
}

function resolveDefaultDetectorImagesPath(dataRoot) {
  const imagesRoot = getImagesRoot(dataRoot);
  return imagesRoot || path.join(dataRoot, DETECTOR_FOLDER_NAME, IMAGES_FOLDER_NAME);
}

function resolveDefaultClassFolderPath(dataRoot) {
  const classFolder = getClassFolderRoot(dataRoot);
  return classFolder || path.join(dataRoot, DETECTOR_FOLDER_NAME, CLASS_FOLDER_NAME);
}

function resolveDefaultVlmImagesPath(dataRoot) {
  const topic = resolveDefaultVlmTopic(dataRoot);
  if (topic?.imagesDir) {
    return topic.imagesDir;
  }
  return path.join(dataRoot, VLM_FOLDER_NAME, VLM_TOPIC_IMAGES_FOLDER);
}

function resolveDefaultVlmJsonPath(dataRoot) {
  const topic = resolveDefaultVlmTopic(dataRoot);
  if (topic?.labelDir) {
    return topic.labelDir;
  }
  return path.join(dataRoot, VLM_FOLDER_NAME, VLM_LABEL_FOLDER_NAME);
}

function resolveDefaultVlmLabelFilePath(dataRoot) {
  const topic = resolveDefaultVlmTopic(dataRoot);
  if (topic?.labelFile) {
    return topic.labelFile;
  }
  return path.join(resolveDefaultVlmJsonPath(dataRoot), VLM_MASTER_JSON_FILE);
}

function suggestVlmTrainingDatasets(dataRoot, options = {}) {
  const refresh = options.refresh === true;
  const vlmRoot = getVlmRoot(dataRoot);
  const cacheKey = vlmRoot && fs.existsSync(vlmRoot)
    ? `${dataRoot}:${fs.statSync(vlmRoot).mtimeMs}`
    : dataRoot;
  if (!refresh
    && vlmTrainingDatasetsCache
    && vlmTrainingDatasetsCache.key === cacheKey
    && Date.now() - vlmTrainingDatasetsCache.at < 60000) {
    return vlmTrainingDatasetsCache.value;
  }

  const topics = listVlmTopicFolders(dataRoot);
  const defaultTopic = resolveDefaultVlmTopic(dataRoot);
  const value = {
    defaultDatasetPath: defaultTopic?.datasetPath || '',
    defaultImagesDatasetPath: defaultTopic?.imagesDatasetPath || '',
    defaultLabelFileDatasetPath: defaultTopic?.labelFileDatasetPath || '',
    options: topics.map((topic) => ({
      name: topic.name,
      datasetPath: topic.datasetPath,
      imagesDatasetPath: topic.imagesDatasetPath,
      labelDatasetPath: topic.labelDatasetPath,
      labelFileDatasetPath: topic.labelFileDatasetPath,
      recordCount: topic.recordCount,
      legacy: Boolean(topic.legacy),
    })),
  };
  vlmTrainingDatasetsCache = { key: cacheKey, at: Date.now(), value };
  return value;
}

let vlmTrainingDatasetsCache = null;

module.exports = {
  CLASS_FOLDER_NAME,
  DETECTOR_FOLDER_NAME,
  IMAGES_FOLDER_NAME,
  VLM_FOLDER_NAME,
  VLM_TOPIC_IMAGES_FOLDER,
  VLM_LABEL_FOLDER_NAME,
  LEGACY_VLM_IMAGES_FOLDER,
  LEGACY_VLM_JSON_FOLDER,
  VLM_MASTER_JSON_FILE,
  countDetectorDatasetFolders,
  countVlmDatasetFolders,
  extractDatasetFolderName,
  getBrowsableImageRoots,
  getClassFolderRoot,
  getDetectorRoot,
  getEventFoldersRoot,
  getImagesRoot,
  getLegacyVlmImagesRoot,
  getLegacyVlmJsonRoot,
  getVlmImagesRoot,
  getVlmJsonRoot,
  getVlmRoot,
  getVlmTopicImagesDir,
  getVlmTopicLabelDir,
  inferDataRootFromImageDirectory,
  inferVlmTopicContext,
  isReservedDatasetRootName,
  isVlmTopicRoot,
  listImageDatasetFolders,
  listVlmTopicFolders,
  resolveClassDefinitionFile,
  resolveClassDefinitionPath,
  resolveDefaultClassFolderPath,
  resolveDefaultDetectorImagesPath,
  resolveDefaultVlmImagesPath,
  resolveDefaultVlmJsonPath,
  resolveDefaultVlmLabelFilePath,
  resolveDefaultVlmTopic,
  resolveVlmLabelFilePath,
  suggestVlmTrainingDatasets,
  toDatasetRelativePath,
  usesDetectorLayout,
  usesImagesLayout,
  usesVlmLayout,
};
