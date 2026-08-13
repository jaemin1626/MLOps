'use strict';

const fs = require('fs');
const path = require('path');
const { listImagesRecursively } = require('./file-system-inspection-service');
const {
  VLM_MASTER_JSON_FILE,
  getBrowsableImageRoots,
  getVlmRoot,
  inferVlmTopicContext,
  resolveDefaultVlmImagesPath,
  resolveVlmLabelFilePath,
} = require('../utils/dataset-layout');

const VLM_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const DEFAULT_HUMAN_PROMPT = '<image>\n당신은 CCTV 관제사입니다. 이미지에 대해 ‘사람 쓰러짐’ 여부를 ‘네/아니요/판단불가’ 중 하나로 답변하고 쉼표로 구분 후 두 줄 설명을 제공해 주세요. 첫 번째 줄에는 사람의 자세와 행동을 묘사하며, 사람이 없으면 이미지에 사람이 없다고 설명하세요. 두 번째 줄에는 사람의 인상착의를, 사람이 없으면 주변 배경을 간단히 설명하세요.';

function formatRecordIndex(index) {
  return String(Math.max(0, Number(index) || 0)).padStart(7, '0');
}

function resolveVlmRoots(imageDirectory, dataRoot = '') {
  const topicContext = inferVlmTopicContext(imageDirectory || dataRoot, dataRoot);
  if (!topicContext) {
    throw new Error('VLM 데이터셋 주제 폴더를 찾지 못했습니다. dataset/vlm/{주제}/Images · label 구조를 확인하세요.');
  }

  const imagesRoot = topicContext.imagesDir || resolveDefaultVlmImagesPath(topicContext.dataRoot);
  const labelDir = topicContext.labelDir || path.dirname(resolveDefaultVlmLabelFilePath(topicContext.dataRoot));
  const labelFile = topicContext.labelFile
    || resolveVlmLabelFilePath(labelDir, topicContext.topicName || '');
  const normalizedImageDirectory = path.resolve(imageDirectory || imagesRoot);
  const imageDirectoryResolved = fs.existsSync(normalizedImageDirectory)
    ? normalizedImageDirectory
    : imagesRoot;

  if (!fs.existsSync(imageDirectoryResolved)) {
    throw new Error(`VLM Images 폴더가 존재하지 않습니다: ${imageDirectoryResolved}`);
  }

  return {
    dataRoot: topicContext.dataRoot,
    topicName: topicContext.topicName || '',
    topicRoot: topicContext.topicRoot,
    layout: topicContext.layout || 'topic',
    imagesRoot,
    labelDir,
    labelFile,
    imageDirectory: imageDirectoryResolved,
  };
}

function loadMasterRecords(labelFile) {
  if (!labelFile || !fs.existsSync(labelFile)) {
    return { filePath: labelFile, records: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(labelFile, 'utf8'));
  return {
    filePath: labelFile,
    records: Array.isArray(parsed) ? parsed : [],
  };
}

function saveMasterRecords(labelFile, records) {
  const filePath = labelFile || path.join('', VLM_MASTER_JSON_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(records, null, 4)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
  return filePath;
}

function toImageRelativePath(imagePath, imagesRoot) {
  return path.relative(imagesRoot, imagePath).split(path.sep).join('/');
}

function normalizeConversations(conversations) {
  if (!Array.isArray(conversations)) {
    return [];
  }
  return conversations
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      from: String(entry.from || '').trim(),
      value: String(entry.value ?? ''),
    }))
    .filter((entry) => entry.from);
}

function buildDefaultRecord(imageRelativePath, index, humanPrompt = DEFAULT_HUMAN_PROMPT) {
  return {
    index: formatRecordIndex(index),
    image: imageRelativePath,
    conversations: [
      { from: 'human', value: humanPrompt },
      { from: 'gpt', value: '' },
    ],
  };
}

function normalizeRecord(record, imageRelativePath, index, humanPrompt = DEFAULT_HUMAN_PROMPT) {
  const conversations = normalizeConversations(record?.conversations);
  const humanEntry = conversations.find((entry) => entry.from === 'human');
  const gptEntry = conversations.find((entry) => entry.from === 'gpt');
  return {
    index: formatRecordIndex(record?.index ?? index),
    image: String(record?.image || imageRelativePath),
    conversations: [
      { from: 'human', value: humanEntry?.value || humanPrompt },
      { from: 'gpt', value: gptEntry?.value || '' },
    ],
  };
}

function upsertRecord(records, record) {
  const nextRecords = [...records];
  const existingIndex = nextRecords.findIndex((entry) => entry.image === record.image);
  if (existingIndex >= 0) {
    nextRecords[existingIndex] = record;
  } else {
    nextRecords.push(record);
  }
  nextRecords.sort((left, right) => String(left.index).localeCompare(String(right.index)));
  return nextRecords;
}

function recordHasAnswer(record) {
  const gptEntry = normalizeConversations(record?.conversations).find((entry) => entry.from === 'gpt');
  return Boolean(String(gptEntry?.value || '').trim());
}

function resolveImageAbsolutePath(imagesRoot, imageRelativePath, topicName = '') {
  const normalized = String(imageRelativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const candidates = [
    path.join(imagesRoot, normalized),
  ];
  if (topicName && normalized.startsWith(`${topicName}/`)) {
    candidates.push(path.join(imagesRoot, normalized.slice(topicName.length + 1)));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function buildVlmTaggingWorkspace(imageDirectory, dataRoot = '') {
  const {
    imagesRoot,
    labelDir,
    labelFile,
    imageDirectory: resolvedImageDirectory,
    topicName,
    topicRoot,
    layout,
  } = resolveVlmRoots(imageDirectory, dataRoot);

  const { records } = loadMasterRecords(labelFile);
  const recordByImage = new Map(records.map((record) => [record.image, record]));
  const imagePaths = listImagesRecursively(resolvedImageDirectory, 5000, VLM_IMAGE_EXTENSIONS);
  const images = imagePaths.map((imagePath, index) => {
    const imageRelativePath = toImageRelativePath(imagePath, imagesRoot);
    const legacyRelativePath = topicName
      ? `${topicName}/${imageRelativePath}`
      : imageRelativePath;
    const existingRecord = recordByImage.get(imageRelativePath)
      || recordByImage.get(legacyRelativePath);
    const hasLabel = recordHasAnswer(existingRecord);
    return {
      name: path.basename(imagePath),
      relativePath: path.relative(resolvedImageDirectory, imagePath).split(path.sep).join('/'),
      imageRelativePath,
      path: imagePath,
      imageUrl: `/api/data/image?path=${encodeURIComponent(imagePath)}`,
      index: formatRecordIndex(existingRecord?.index ?? index),
      hasLabel,
      jsonPath: labelFile,
    };
  });

  return {
    imageDirectory: resolvedImageDirectory,
    topicName,
    topicRoot,
    layout,
    imagesRoot,
    labelDir,
    labelFile,
    masterJsonPath: labelFile,
    jsonRoot: labelDir,
    defaultHumanPrompt: DEFAULT_HUMAN_PROMPT,
    images,
    summary: {
      totalImages: images.length,
      labeledImages: images.filter((image) => image.hasLabel).length,
      unlabeledImages: images.filter((image) => !image.hasLabel).length,
    },
  };
}

function loadVlmRecord(imagePath, imageDirectory, dataRoot = '', options = {}) {
  const { imagesRoot, labelFile, topicName } = resolveVlmRoots(imageDirectory, dataRoot);
  const imageRelativePath = toImageRelativePath(imagePath, imagesRoot);
  const legacyRelativePath = topicName ? `${topicName}/${imageRelativePath}` : imageRelativePath;
  const { records } = loadMasterRecords(labelFile);
  const existingRecord = records.find((record) => record.image === imageRelativePath)
    || records.find((record) => record.image === legacyRelativePath);
  const imagePaths = listImagesRecursively(imageDirectory, 5000, VLM_IMAGE_EXTENSIONS);
  const imageIndex = Math.max(0, imagePaths.findIndex((candidate) => path.resolve(candidate) === path.resolve(imagePath)));
  const humanPrompt = String(options.humanPrompt || DEFAULT_HUMAN_PROMPT);
  const record = existingRecord
    ? normalizeRecord(existingRecord, imageRelativePath, imageIndex, humanPrompt)
    : buildDefaultRecord(imageRelativePath, imageIndex, humanPrompt);

  return {
    record,
    imageRelativePath,
    labelFile,
    masterJsonPath: labelFile,
    hasLabel: recordHasAnswer(record),
  };
}

function saveVlmRecord(record, imagePath, imageDirectory, dataRoot = '', options = {}) {
  const { imagesRoot, labelFile } = resolveVlmRoots(imageDirectory, dataRoot);
  const imageRelativePath = toImageRelativePath(imagePath, imagesRoot);
  const imagePaths = listImagesRecursively(imageDirectory, 5000, VLM_IMAGE_EXTENSIONS);
  const imageIndex = Math.max(0, imagePaths.findIndex((candidate) => path.resolve(candidate) === path.resolve(imagePath)));
  const humanPrompt = String(options.humanPrompt || DEFAULT_HUMAN_PROMPT);
  const normalizedRecord = normalizeRecord(record, imageRelativePath, imageIndex, humanPrompt);
  const { records } = loadMasterRecords(labelFile);
  const masterPath = saveMasterRecords(labelFile, upsertRecord(records, normalizedRecord));

  return {
    saved: true,
    record: normalizedRecord,
    masterJsonPath: masterPath,
    labelFile: masterPath,
    hasLabel: recordHasAnswer(normalizedRecord),
  };
}

function isPathInsideDirectory(folderPath, rootPath) {
  const folder = path.resolve(folderPath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, folder);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveVlmSummaryContext(folderPath, dataRoot = '') {
  const folder = path.resolve(folderPath);
  const browseRoots = getBrowsableImageRoots(dataRoot);
  const vlmItems = browseRoots.filter((item) => item.kind === 'vlm');
  if (!vlmItems.length) {
    return null;
  }

  for (const item of vlmItems) {
    if (isPathInsideDirectory(folder, item.imagesRoot)) {
      return {
        scanDirectory: folder,
        vlmItems: [item],
        aggregate: false,
      };
    }
  }

  for (const item of vlmItems) {
    if (isPathInsideDirectory(folder, item.containerPath)) {
      return {
        scanDirectory: item.imagesRoot,
        vlmItems: [item],
        aggregate: false,
      };
    }
  }

  const vlmRoot = getVlmRoot(dataRoot);
  if (vlmRoot && isPathInsideDirectory(folder, vlmRoot)) {
    return {
      scanDirectory: null,
      vlmItems,
      aggregate: true,
    };
  }

  return null;
}

function shouldUseVlmSummary(folderPath, dataRoot = '') {
  return Boolean(resolveVlmSummaryContext(folderPath, dataRoot));
}

function scanVlmEventFolderSummary(folderPath, dataRoot = '', options = {}) {
  const context = resolveVlmSummaryContext(folderPath, dataRoot);
  if (!context) {
    throw new Error('VLM 데이터셋 폴더를 찾지 못했습니다.');
  }

  const maximumImages = options.maximumImages || 100;
  const workspaces = context.aggregate
    ? context.vlmItems.map((item) => buildVlmTaggingWorkspace(item.imagesRoot, dataRoot))
    : [buildVlmTaggingWorkspace(context.scanDirectory, dataRoot)];

  const labelFiles = workspaces
    .map((workspace) => workspace.masterJsonPath)
    .filter(Boolean);
  const allImages = workspaces
    .flatMap((workspace) => workspace.images)
    .sort((left, right) => left.path.localeCompare(right.path, 'ko'));
  const totalImages = workspaces.reduce((sum, workspace) => sum + workspace.summary.totalImages, 0);
  const labeledImages = workspaces.reduce((sum, workspace) => sum + workspace.summary.labeledImages, 0);
  const images = allImages.slice(0, maximumImages).map((image) => ({
    name: image.name,
    path: image.path,
    hasLabel: image.hasLabel,
    labelPath: image.jsonPath,
    relativePath: image.relativePath,
  }));

  return {
    folderName: path.basename(folderPath),
    folderPath,
    eventFolder: true,
    datasetType: 'vlm',
    labelFile: labelFiles[0] || '',
    labelFiles,
    totalImages,
    imageCount: totalImages,
    labelCount: labeledImages,
    matchedImageCount: labeledImages,
    unlabeledImageCount: Math.max(0, totalImages - labeledImages),
    truncated: totalImages > maximumImages,
    images,
  };
}

module.exports = {
  DEFAULT_HUMAN_PROMPT,
  buildVlmTaggingWorkspace,
  loadVlmRecord,
  resolveImageAbsolutePath,
  saveVlmRecord,
  scanVlmEventFolderSummary,
  shouldUseVlmSummary,
  resolveVlmSummaryContext,
};