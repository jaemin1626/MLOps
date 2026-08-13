'use strict';

const fs = require('fs');
const path = require('path');
const {
  getBrowsableImageRoots,
  getEventFoldersRoot,
  getImagesRoot,
  getVlmRoot,
  isReservedDatasetRootName,
} = require('../utils/dataset-layout');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);

function isImageFile(fileName) {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isYoloLabelFile(fileName) {
  return path.extname(fileName).toLowerCase() === '.txt';
}

function listFolderEntries(folderPath) {
  return fs.readdirSync(folderPath, { withFileTypes: true })
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name, 'ko');
    });
}

function buildDirectoryTree(rootPath, options = {}, depth = 0) {
  const maximumDepth = Number.isInteger(options.maximumDepth) ? options.maximumDepth : 4;
  const node = {
    name: path.basename(rootPath) || rootPath,
    path: rootPath,
    type: 'directory',
    children: [],
  };

  if (depth >= maximumDepth) {
    node.truncated = true;
    return node;
  }

  try {
    for (const entry of listFolderEntries(rootPath)) {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        node.children.push(buildDirectoryTree(entryPath, options, depth + 1));
      }
    }
  } catch (error) {
    node.error = error.message;
  }
  return node;
}

function buildImagesDirectorySubtree(imagesRoot, options = {}, depth = 0) {
  const maximumDepth = Number.isInteger(options.maximumDepth) ? options.maximumDepth : 4;
  const node = {
    name: path.basename(imagesRoot) || imagesRoot,
    path: imagesRoot,
    type: 'directory',
    children: [],
  };

  if (depth >= maximumDepth) {
    node.truncated = true;
    return node;
  }

  try {
    for (const entry of listFolderEntries(imagesRoot)) {
      if (!entry.isDirectory()) {
        continue;
      }
      node.children.push(buildImagesDirectorySubtree(
        path.join(imagesRoot, entry.name),
        options,
        depth + 1,
      ));
    }
  } catch (error) {
    node.error = error.message;
  }
  return node;
}

function buildDatasetImagesDirectoryTree(dataRoot, options = {}) {
  const rootNode = {
    name: path.basename(dataRoot) || dataRoot,
    path: dataRoot,
    type: 'directory',
    children: [],
  };

  const browseRoots = getBrowsableImageRoots(dataRoot);
  if (browseRoots.length) {
    const detectorRoot = browseRoots.find((item) => item.kind === 'detector');
    if (detectorRoot) {
      rootNode.children.push({
        name: path.basename(detectorRoot.containerPath),
        path: detectorRoot.containerPath,
        type: 'directory',
        children: [buildImagesDirectorySubtree(detectorRoot.imagesRoot, options, 1)],
      });
    }

    const vlmItems = browseRoots.filter((item) => item.kind === 'vlm');
    const vlmRoot = getVlmRoot(dataRoot);
    if (vlmItems.length && vlmRoot) {
      const vlmNode = {
        name: path.basename(vlmRoot),
        path: vlmRoot,
        type: 'directory',
        children: [],
      };
      for (const item of vlmItems) {
        if (item.legacy) {
          vlmNode.children.push(buildImagesDirectorySubtree(item.imagesRoot, options, 0));
          continue;
        }
        vlmNode.children.push({
          name: item.topicName,
          path: item.containerPath,
          type: 'directory',
          children: [buildImagesDirectorySubtree(item.imagesRoot, options, 1)],
        });
      }
      rootNode.children.push(vlmNode);
    }

    return rootNode;
  }

  const imagesRoot = getImagesRoot(dataRoot);
  if (imagesRoot && imagesRoot !== dataRoot) {
    rootNode.children.push(buildImagesDirectorySubtree(imagesRoot, options, 0));
    return rootNode;
  }

  return buildDirectoryTree(dataRoot, options, 0);
}

function scanFolderSummary(folderPath, options = {}) {
  const maximumFiles = options.maximumFiles || 5000;
  const entries = listFolderEntries(folderPath);
  const files = entries.filter((entry) => entry.isFile()).slice(0, maximumFiles);
  const imageFiles = files.filter((entry) => isImageFile(entry.name));
  const labelFiles = files.filter((entry) => isYoloLabelFile(entry.name));
  const labelBaseNames = new Set(labelFiles.map((entry) => path.parse(entry.name).name));
  const matchedImages = imageFiles.filter((entry) => labelBaseNames.has(path.parse(entry.name).name));
  const unlabeledImages = imageFiles.filter((entry) => !labelBaseNames.has(path.parse(entry.name).name));

  return {
    folderName: path.basename(folderPath),
    folderPath,
    totalFiles: files.length,
    imageCount: imageFiles.length,
    labelCount: labelFiles.length,
    matchedImageCount: matchedImages.length,
    unlabeledImageCount: unlabeledImages.length,
    truncated: entries.filter((entry) => entry.isFile()).length > maximumFiles,
    images: imageFiles.slice(0, 100).map((entry) => ({
      name: entry.name,
      path: path.join(folderPath, entry.name),
      hasLabel: labelBaseNames.has(path.parse(entry.name).name),
    })),
  };
}

function listImagesRecursively(rootPath, maximumImages = 5000, extensions = IMAGE_EXTENSIONS) {
  const output = [];
  const visit = (folderPath) => {
    if (output.length >= maximumImages) {
      return;
    }
    for (const entry of listFolderEntries(folderPath)) {
      const entryPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        output.push(entryPath);
      }
      if (output.length >= maximumImages) {
        break;
      }
    }
  };
  visit(rootPath);
  return output;
}

function diskUsageForPath(targetPath) {
  if (typeof fs.statfsSync !== 'function') {
    return { totalBytes: 0, usedBytes: 0, freeBytes: 0, percent: 0 };
  }
  const stats = fs.statfsSync(targetPath);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const percent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  return { totalBytes, usedBytes, freeBytes, percent };
}

function folderMatchesQuery(folderName, relativePath, query) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    return true;
  }
  const lowerQuery = normalizedQuery.toLowerCase();
  return folderName.toLowerCase().includes(lowerQuery)
    || folderName.includes(normalizedQuery)
    || String(relativePath || '').toLowerCase().includes(lowerQuery)
    || String(relativePath || '').includes(normalizedQuery);
}

function describeRootDirectory(rootPath) {
  try {
    const entries = listFolderEntries(rootPath);
    const directories = entries.filter((entry) => entry.isDirectory());
    return {
      exists: true,
      isEmpty: directories.length === 0,
      childDirectoryCount: directories.length,
      childDirectoryNames: directories.map((entry) => entry.name),
    };
  } catch (error) {
    return {
      exists: false,
      isEmpty: true,
      childDirectoryCount: 0,
      childDirectoryNames: [],
      error: error.message,
    };
  }
}

function listSubfolders(rootPath, options = {}) {
  const maximumDepth = Number.isInteger(options.maximumDepth) ? options.maximumDepth : 8;
  const maximumResults = options.maximumResults || 500;
  const query = String(options.query || '').trim();
  const immediateOnly = options.immediateOnly !== false && !query;

  if (immediateOnly) {
    try {
      return listFolderEntries(rootPath)
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: path.join(rootPath, entry.name),
          relativePath: entry.name,
          depth: 0,
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
    } catch (_error) {
      return [];
    }
  }

  const subfolders = [];
  const visit = (folderPath, depth) => {
    if (subfolders.length >= maximumResults || depth > maximumDepth) {
      return;
    }
    let entries;
    try {
      entries = listFolderEntries(folderPath);
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(folderPath, entry.name);
      if (folderMatchesQuery(entry.name, path.relative(rootPath, entryPath) || entry.name, query)) {
        subfolders.push({
          name: entry.name,
          path: entryPath,
          relativePath: path.relative(rootPath, entryPath) || entry.name,
          depth,
        });
      }
      visit(entryPath, depth + 1);
    }
  };

  visit(rootPath, 0);
  return subfolders.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'ko'));
}

function discoverEventFolders(rootPath, options = {}) {
  const browseRoots = getBrowsableImageRoots(rootPath);
  if (browseRoots.length) {
    const byPath = new Map();
    for (const item of browseRoots) {
      const folders = listSubfolders(item.imagesRoot, options);
      for (const folder of folders) {
        const relativeFromImages = folder.relativePath || folder.name;
        byPath.set(folder.path, {
          ...folder,
          relativePath: item.displayPrefix
            ? `${item.displayPrefix}/${relativeFromImages}`
            : relativeFromImages,
        });
      }
    }
    return Array.from(byPath.values())
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'ko'));
  }

  const eventRoot = getEventFoldersRoot(rootPath);
  const folders = listSubfolders(eventRoot, options);
  if (eventRoot === rootPath) {
    return folders.filter((folder) => !isReservedDatasetRootName(folder.name));
  }
  return folders;
}

function resolveLabelPathForImage(imagePath, eventRoot) {
  const baseName = path.parse(imagePath).name;
  const imageDirectory = path.dirname(imagePath);
  const candidates = [
    path.join(imageDirectory, `${baseName}.txt`),
    path.join(eventRoot, 'labels', `${baseName}.txt`),
    path.join(eventRoot, 'label', `${baseName}.txt`),
  ];
  const imagesRoot = path.join(eventRoot, 'images');
  if (isPathInside(imageDirectory, imagesRoot)) {
    candidates.push(path.join(eventRoot, 'labels', `${baseName}.txt`));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function isPathInside(candidatePath, rootPath) {
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function scanEventFolderSummary(folderPath, options = {}) {
  const maximumImages = options.maximumImages || 100;
  const imagePaths = listImagesRecursively(folderPath, options.maximumFiles || 50000);
  let labelCount = 0;
  let matchedImageCount = 0;
  const images = [];

  for (const imagePath of imagePaths) {
    const labelPath = resolveLabelPathForImage(imagePath, folderPath);
    const hasLabel = Boolean(labelPath);
    if (hasLabel) {
      labelCount += 1;
      matchedImageCount += 1;
    }
    if (images.length < maximumImages) {
      images.push({
        name: path.basename(imagePath),
        path: imagePath,
        hasLabel,
        labelPath,
        relativePath: path.relative(folderPath, imagePath),
      });
    }
  }

  return {
    folderName: path.basename(folderPath),
    folderPath,
    eventFolder: true,
    totalImages: imagePaths.length,
    imageCount: imagePaths.length,
    labelCount,
    matchedImageCount,
    unlabeledImageCount: imagePaths.length - matchedImageCount,
    truncated: imagePaths.length > maximumImages,
    images,
  };
}

module.exports = {
  IMAGE_EXTENSIONS,
  buildDatasetImagesDirectoryTree,
  buildDirectoryTree,
  describeRootDirectory,
  discoverEventFolders,
  diskUsageForPath,
  isImageFile,
  listImagesRecursively,
  listSubfolders,
  scanEventFolderSummary,
  scanFolderSummary,
};
