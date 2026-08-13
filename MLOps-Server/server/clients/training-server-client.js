'use strict';

class TrainingServerClient {
  constructor(runtimeConfig) {
    const trainingServer = runtimeConfig.trainingServer || {};
    this.baseUrl = String(
      trainingServer.baseUrl
      || runtimeConfig.training?.agentBaseUrl
      || runtimeConfig.export?.agentBaseUrl
      || '',
    ).replace(/\/$/, '');
    this.timeoutMs = Number(
      trainingServer.requestTimeoutMs
      || runtimeConfig.training?.requestTimeoutMs
      || 10000,
    );
    this.authToken = String(trainingServer.authToken || '').trim();
    this.mlopsPublicBaseUrl = String(trainingServer.mlopsPublicBaseUrl || '').replace(/\/$/, '');
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  buildCallbackUrl(relativePath) {
    if (!this.mlopsPublicBaseUrl) {
      return null;
    }
    return `${this.mlopsPublicBaseUrl}${relativePath.startsWith('/') ? relativePath : `/${relativePath}`}`;
  }

  buildUrl(apiPath, query = {}) {
    if (!this.isConfigured()) {
      throw new Error('학습 서버 baseUrl이 설정되지 않았습니다.');
    }
    const url = new URL(`${this.baseUrl}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).length > 0) {
        url.searchParams.set(key, String(value));
      }
    });
    return url;
  }

  buildHeaders(extraHeaders = {}) {
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  async request(method, apiPath, options = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs || this.timeoutMs);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = this.buildUrl(apiPath, options.query);
      const headers = this.buildHeaders(options.headers || {});
      const init = { method, headers, signal: controller.signal };
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }
      const response = await fetch(url, init);
      if (options.responseType === 'buffer') {
        if (!response.ok) {
          throw new Error(`학습 서버 응답 오류: HTTP ${response.status}`);
        }
        return {
          buffer: Buffer.from(await response.arrayBuffer()),
          contentType: response.headers.get('content-type') || 'application/octet-stream',
        };
      }
      const text = await response.text();
      let payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (_error) {
          throw new Error(`학습 서버 JSON 응답을 해석하지 못했습니다: ${text.slice(0, 200)}`);
        }
      }
      if (!response.ok) {
        throw new Error(payload.error || payload.message || `학습 서버 응답 오류: HTTP ${response.status}`);
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`학습 서버 요청 시간 초과 (${timeoutMs}ms)`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getHealth() {
    return this.request('GET', '/api/v1/health');
  }

  async getDataTree(path, options = {}) {
    return this.request('POST', '/api/v1/data/tree', {
      body: { path, maximumDepth: options.maximumDepth },
    });
  }

  async getDataSummary(path, options = {}) {
    return this.request('POST', '/api/v1/data/summary', {
      body: { path, maximumFiles: options.maximumFiles },
    });
  }

  async getDataImage(path) {
    return this.request('GET', '/api/v1/data/image', {
      query: { path },
      responseType: 'buffer',
    });
  }

  async listTaggingImages(imageDirectory, labelDirectory) {
    return this.request('GET', '/api/v1/tagging/images', {
      query: { imageDirectory, labelDirectory },
    });
  }

  async getTaggingLabels(imagePath, labelDirectory) {
    return this.request('GET', '/api/v1/tagging/labels', {
      query: { imagePath, labelDirectory },
    });
  }

  async saveTaggingLabels(imagePath, labelDirectory, labels) {
    return this.request('POST', '/api/v1/tagging/labels', {
      body: { imagePath, labelDirectory, labels },
    });
  }

  async listTrainingJobs() {
    return this.request('GET', '/api/v1/training/jobs');
  }

  async getTrainingJob(jobId) {
    return this.request('GET', `/api/v1/training/jobs/${encodeURIComponent(jobId)}`);
  }

  async previewTrainingCommand(input) {
    return this.request('POST', '/api/v1/training/command-preview', { body: input });
  }

  async startTrainingJob(payload) {
    return this.request('POST', '/api/v1/training/jobs', { body: payload });
  }

  async stopTrainingJob(jobId) {
    return this.request('POST', `/api/v1/training/jobs/${encodeURIComponent(jobId)}/stop`);
  }

  async createDatasetSplit(payload) {
    return this.request('POST', '/api/v1/datasets/split', { body: payload });
  }

  async submitCommand(payload) {
    return this.request('POST', '/api/v1/commands', { body: payload });
  }

  async getCommandTask(taskId) {
    return this.request('GET', `/api/v1/commands/${encodeURIComponent(taskId)}`);
  }

  async waitForCommandTask(taskId, options = {}) {
    const timeoutMs = Number(options.timeoutMs || this.timeoutMs * 6 || 60000);
    const intervalMs = Number(options.intervalMs || 800);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const task = await this.getCommandTask(taskId);
      if (task.status === 'completed') return task;
      if (task.status === 'failed') {
        throw Object.assign(new Error(task.errorMessage || '학습 서버 명령 실행 실패'), {
          logs: task.logs,
          logText: task.logText,
          status: task.status,
          result: task.result,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`학습 서버 명령 시간 초과 (${timeoutMs}ms): ${taskId}`);
  }

  async listModels() {
    return this.request('GET', '/api/v1/models');
  }

  async listRunFolders() {
    return this.request('GET', '/api/v1/runs/folders');
  }

  async listRunPtFiles(folderName) {
    return this.request('GET', '/api/v1/runs/pt-files', {
      query: { folder: folderName },
    });
  }

  async listBaseWeights() {
    return this.request('GET', '/api/v1/weights');
  }

  async runPseudoLabel(payload, options = {}) {
    return this.request('POST', '/api/v1/tagging/pseudo-label', {
      body: payload,
      timeoutMs: options.timeoutMs || 300000,
    });
  }

  async getExport(exportId) {
    return this.request('GET', `/api/v1/exports/${encodeURIComponent(exportId)}`);
  }

  async listExports() {
    return this.request('GET', '/api/v1/exports');
  }

  async previewExportCommand(input) {
    return this.request('POST', '/api/v1/exports/command-preview', { body: input });
  }

  async startExport(payload) {
    return this.request('POST', '/api/v1/exports', { body: payload });
  }

  async statWorkspaceFile(relativePath, options = {}) {
    return this.request('GET', '/api/v1/workspace/file/stat', {
      query: { path: relativePath },
      timeoutMs: options.timeoutMs || this.timeoutMs,
    });
  }

  async getWorkspaceFile(relativePath, options = {}) {
    return this.request('GET', '/api/v1/workspace/file', {
      query: { path: relativePath },
      responseType: 'buffer',
      timeoutMs: options.timeoutMs || 300000,
    });
  }
}

module.exports = {
  TrainingServerClient,
};
