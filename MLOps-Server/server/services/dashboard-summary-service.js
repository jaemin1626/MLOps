'use strict';

const fs = require('fs');
const path = require('path');
const { diskUsageForPath } = require('./file-system-inspection-service');
const {
  countDetectorDatasetFolders,
  countVlmDatasetFolders,
} = require('../utils/dataset-layout');

function tailTextFile(filePath, maximumLines = 30) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).slice(-maximumLines).join('\n').trim();
}


class DashboardSummaryService {
  constructor(runtimeConfig, trainingJobService, modelCatalogService, onnxExportService) {
    this.config = runtimeConfig;
    this.trainingJobService = trainingJobService;
    this.modelCatalogService = modelCatalogService;
    this.onnxExportService = onnxExportService;
  }

  async getSummary() {
    const jobs = await this.trainingJobService.listJobs();
    const models = await this.modelCatalogService.listModels();
    const exports = await this.onnxExportService.listExports();
    const runningJobs = jobs.filter((job) => job.status === 'running');
    const completedJobs = jobs.filter((job) => job.status === 'completed');
    const deployedModelCount = models.filter((model) => model.deploymentStatus === 'deployed').length;
    const latestJob = jobs[0] || null;
    const storage = diskUsageForPath(this.config.paths.modelRoot);
    const distribution = {
      running: jobs.filter((job) => job.status === 'running').length,
      completed: jobs.filter((job) => job.status === 'completed').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      waiting: jobs.filter((job) => job.status === 'waiting').length,
      unknown: jobs.filter((job) => job.status === 'status_unknown').length,
    };

    const dataRoot = this.config.paths.dataRoot;
    const detectorDatasetCount = countDetectorDatasetFolders(dataRoot);
    const vlmDatasetCount = countVlmDatasetFolders(dataRoot);

    return {
      cards: {
        runningTraining: runningJobs.length,
        completedTraining: completedJobs.length,
        detectorDatasetCount,
        vlmDatasetCount,
        datasetCount: detectorDatasetCount + vlmDatasetCount,
        deployedModelCount,
        storage,
      },
      recentJobs: jobs.slice(0, this.config.scan.recentItemLimit || 8),
      recentExports: exports.slice(0, this.config.scan.recentItemLimit || 8),
      distribution,
      latestLog: latestJob ? {
        jobId: latestJob.id,
        jobName: latestJob.name,
        text: tailTextFile(latestJob.logPath, 24),
      } : null,
      modelCount: models.length,
    };
  }
}

module.exports = {
  DashboardSummaryService,
  tailTextFile,
};
