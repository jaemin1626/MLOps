'use strict';

const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.onnx': 'application/octet-stream',
};

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function readJsonBody(request, maximumBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      received += chunk.length;
      if (received > maximumBytes) {
        reject(Object.assign(new Error('요청 본문 크기가 제한을 초과했습니다.'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_error) {
        reject(Object.assign(new Error('JSON 요청 형식이 올바르지 않습니다.'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function sendBuffer(response, buffer, options = {}) {
  const headers = {
    'Content-Type': options.contentType || 'application/octet-stream',
    'Content-Length': buffer.length,
    'Cache-Control': options.cacheControl || 'no-cache',
  };
  if (options.contentDisposition) {
    headers['Content-Disposition'] = options.contentDisposition;
  }
  response.writeHead(200, headers);
  response.end(buffer);
}

function streamFileAttachment(response, filePath, options = {}) {
  const stats = fs.statSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const fileName = options.fileName || path.basename(filePath);
  const headers = {
    'Content-Type': options.contentType || MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': options.cacheControl || 'no-cache',
    'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
  };
  response.writeHead(200, headers);
  const stream = fs.createReadStream(filePath);
  stream.pipe(response);
  if (options.deleteAfterSend) {
    const cleanup = () => fs.unlink(filePath, () => {});
    response.on('finish', cleanup);
    response.on('close', cleanup);
    stream.on('error', cleanup);
  }
}

function streamFile(response, filePath, options = {}) {
  const stats = fs.statSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': options.contentType || MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': options.cacheControl || 'no-cache',
  });
  fs.createReadStream(filePath).pipe(response);
}

function routeMatch(pathname, expression) {
  const match = pathname.match(expression);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

module.exports = {
  MIME_TYPES,
  readJsonBody,
  routeMatch,
  sendBuffer,
  sendJson,
  streamFile,
  streamFileAttachment,
};
