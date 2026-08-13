'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { getRuntimeConfig } = require('./services/runtime-config-service');
const { TrainingConnectionHub } = require('./services/training-connection-hub');
const { AgentTaskService } = require('./services/agent-task-service');
const { createApiRouter } = require('./routes/mlops-api-router');
const { sendJson, streamFile } = require('./utils/http-api-helpers');
const { isPathInside } = require('./utils/path-security');

const runtimeConfig = getRuntimeConfig();
Object.values(runtimeConfig.paths).forEach((directory) => fs.mkdirSync(directory, { recursive: true }));

const connectionHub = new TrainingConnectionHub(runtimeConfig);
const agentTaskService = new AgentTaskService();

const apiRouter = createApiRouter({
  runtimeConfig,
  connectionHub,
  agentTaskService,
});

const publicDirectory = path.join(runtimeConfig.projectRoot, 'public');

function serveStaticFile(request, response, parsedUrl) {
  const requestedPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  let filePath = path.resolve(publicDirectory, `.${decodedPath}`);

  if (!isPathInside(filePath, publicDirectory)) {
    return sendJson(response, 403, { error: '허용되지 않은 정적 파일 경로입니다.' });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(publicDirectory, 'index.html');
  }
  const extension = path.extname(filePath).toLowerCase();
  return streamFile(response, filePath, {
    cacheControl: extension === '.html' || extension === '.js' || extension === '.css'
      ? 'no-cache'
      : 'public, max-age=300',
  });
}

const server = http.createServer(async (request, response) => {
  const parsedUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  try {
    if (parsedUrl.pathname.startsWith('/api/')) {
      await apiRouter(request, response, parsedUrl);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: '지원하지 않는 HTTP Method입니다.' });
      return;
    }
    serveStaticFile(request, response, parsedUrl);
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) {
      console.error(error);
    }
    if (!response.headersSent) {
      const payload = { error: error.message || '요청을 처리하지 못했습니다.' };
      if (error.logs) payload.logs = error.logs;
      if (error.logText) payload.logText = error.logText;
      if (error.status) payload.status = error.status;
      if (error.activeConnectionId) payload.activeConnectionId = error.activeConnectionId;
      sendJson(response, error.statusCode || 400, payload);
    } else if (!response.writableEnded) {
      response.end();
    }
  }
});

const listenPort = Number(process.env.PORT || runtimeConfig.server.port);
server.listen(listenPort, runtimeConfig.server.host, () => {
  console.log(`Intellivix MLOps: http://localhost:${listenPort}`);
  console.log(
    `Execution mode: data=${runtimeConfig.data.executionMode}, training=${runtimeConfig.training.executionMode}, models=${runtimeConfig.models.executionMode}, export=${runtimeConfig.export.executionMode}`,
  );
  const active = connectionHub.getActiveConnection();
  if (active) {
    console.log(`Active training connection: ${active.name}`);
  } else {
    console.log('Active training connection: none (Connection 관리에서 SSH 연결 필요)');
  }
});

module.exports = { server, runtimeConfig, connectionHub };
