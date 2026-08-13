'use strict';

const fs = require('fs');

function initializeSse(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(': connected\n\n');
}

function sendSse(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Polls the file from its previous byte offset. This works after server restarts too.
 */
function streamTextFile(response, filePath, options = {}) {
  initializeSse(response);
  let offset = 0;
  let closed = false;

  const readNewContent = () => {
    if (closed || !fs.existsSync(filePath)) {
      return;
    }
    const stats = fs.statSync(filePath);
    if (stats.size < offset) {
      offset = 0;
    }
    if (stats.size === offset) {
      return;
    }
    const length = stats.size - offset;
    const buffer = Buffer.alloc(length);
    const descriptor = fs.openSync(filePath, 'r');
    fs.readSync(descriptor, buffer, 0, length, offset);
    fs.closeSync(descriptor);
    offset = stats.size;
    sendSse(response, 'log', { text: buffer.toString('utf8') });
  };

  readNewContent();
  const interval = setInterval(readNewContent, options.intervalMs || 700);
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);

  response.on('close', () => {
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
  });
}

module.exports = {
  initializeSse,
  sendSse,
  streamTextFile,
};
