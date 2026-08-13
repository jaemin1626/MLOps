'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildDatasetImagesDirectoryTree,
  describeRootDirectory,
  discoverEventFolders,
  listImagesRecursively,
  scanEventFolderSummary,
  scanFolderSummary,
} = require('./file-system-inspection-service');
const { loadLabels, saveLabels, buildTaggingWorkspace, listClassFileBrowser, listFolderBrowser, loadClassNamesFromFile, loadClassNamesFromText } = require('./yolo-label-service');
const { buildVlmTaggingWorkspace, loadVlmRecord, saveVlmRecord, scanVlmEventFolderSummary, shouldUseVlmSummary } = require('./vlm-label-service');

function isRemoteMode(configSection) {
  const mode = configSection?.executionMode || 'local';
  return mode === 'remote' || mode === 'agent';
}

class DataManagementService {
  constructor(runtimeConfig, trainingServerClient) {
    this.config = runtimeConfig;
    this.client = trainingServerClient;
    this.mode = runtimeConfig.data?.executionMode || 'local';
  }

  usesRemoteApi() {
    return isRemoteMode({ executionMode: this.mode }) && this.client.isConfigured();
  }

  async getTree(rootPath, options = {}) {
    if (this.usesRemoteApi() && !fs.existsSync(rootPath)) {
      try {
        return await this.client.getDataTree(rootPath, options);
      } catch (error) {
        console.warn(`[DataManagementService] 원격 데이터 Tree 조회 실패, 로컬 상태 사용: ${error.message}`);
      }
    }
    return {
      rootPath,
      tree: buildDatasetImagesDirectoryTree(rootPath, options),
    };
  }

  async getSummary(folderPath, options = {}) {
    const dataRoot = this.config.paths.dataRoot;
    if (options.recursive && shouldUseVlmSummary(folderPath, dataRoot)) {
      return scanVlmEventFolderSummary(folderPath, dataRoot, options);
    }
    if (this.usesRemoteApi()) {
      try {
        return await this.client.getDataSummary(folderPath, options);
      } catch (error) {
        console.warn(`[DataManagementService] 원격 데이터 Summary 조회 실패, 로컬 상태 사용: ${error.message}`);
      }
    }
    if (options.recursive) {
      return scanEventFolderSummary(folderPath, options);
    }
    return scanFolderSummary(folderPath, options);
  }

  async searchEventFolders(rootPath, options = {}) {
    if (this.usesRemoteApi()) {
      try {
        return await this.client.searchEventFolders(rootPath, options);
      } catch (error) {
        console.warn(`[DataManagementService] 원격 이벤트 폴더 검색 실패, 로컬 상태 사용: ${error.message}`);
      }
    }
    const eventFolders = discoverEventFolders(rootPath, {
      query: options.query,
      immediateOnly: options.immediateOnly,
      maximumDepth: options.maximumDepth || this.config.scan?.maximumTreeDepth || 8,
      maximumResults: options.maximumResults || 300,
    });
    const rootStatus = describeRootDirectory(rootPath);
    return {
      rootPath,
      query: options.query || '',
      count: eventFolders.length,
      eventFolders,
      rootStatus,
      hint: rootStatus.isEmpty
        ? '데이터 root 폴더가 비어 있습니다. 학습 서버(/home/ailab2/Workspace/MLops_test/dataset) 경로가 이 서버에 마운트되었는지 확인하세요.'
        : null,
    };
  }

  async getImageBuffer(imagePath) {
    if (this.usesRemoteApi()) {
      return this.client.getDataImage(imagePath);
    }
    return null;
  }

  async listTaggingImages(imageDirectory, labelDirectory) {
    if (this.usesRemoteApi()) {
      try {
        return await this.client.listTaggingImages(imageDirectory, labelDirectory);
      } catch (error) {
        console.warn(`[DataManagementService] 원격 Tagging 이미지 조회 실패, 로컬 상태 사용: ${error.message}`);
      }
    }
    return buildTaggingWorkspace(imageDirectory, this.config.paths.dataRoot);
  }

  async getLabels(imagePath, imageDirectory, labelDirectory, options = {}) {
    if (this.usesRemoteApi()) {
      try {
        return await this.client.getTaggingLabels(imagePath, labelDirectory);
      } catch (error) {
        console.warn(`[DataManagementService] 원격 Tagging 라벨 조회 실패, 로컬 상태 사용: ${error.message}`);
      }
    }
    return loadLabels(imagePath, imageDirectory, labelDirectory, options);
  }

  async saveLabels(imagePath, imageDirectory, labelDirectory, labels, options = {}) {
    if (this.usesRemoteApi()) {
      try {
        return await this.client.saveTaggingLabels(imagePath, labelDirectory, labels);
      } catch (error) {
        console.warn(`[DataManagementService] 원격 Tagging 라벨 저장 실패, 로컬 상태 사용: ${error.message}`);
      }
    }
    const labelPath = saveLabels(imagePath, imageDirectory, labelDirectory, labels, options);
    return { saved: true, labelPath, count: labels.length, saveBesideImage: Boolean(options.saveBesideImage) };
  }

  async browseClassDefinitionFiles(directoryPath) {
    return listClassFileBrowser(directoryPath);
  }

  async browseTaggingFolders(directoryPath) {
    return listFolderBrowser(directoryPath);
  }

  async loadClassDefinitionFile(filePath) {
    return loadClassNamesFromFile(filePath);
  }

  async loadClassDefinitionFromText(text, fileName = 'classes.txt') {
    return loadClassNamesFromText(text, fileName);
  }

  async listVlmTaggingImages(imageDirectory) {
    return buildVlmTaggingWorkspace(
      imageDirectory || this.config.paths.dataRoot,
      this.config.paths.dataRoot,
    );
  }

  async getVlmRecord(imagePath, imageDirectory, options = {}) {
    return loadVlmRecord(
      imagePath,
      imageDirectory,
      this.config.paths.dataRoot,
      options,
    );
  }

  async saveVlmRecord(imagePath, imageDirectory, record, options = {}) {
    return saveVlmRecord(
      record,
      imagePath,
      imageDirectory,
      this.config.paths.dataRoot,
      options,
    );
  }
}

module.exports = {
  DataManagementService,
  isRemoteMode,
};
