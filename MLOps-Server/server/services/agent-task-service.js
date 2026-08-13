'use strict';

const crypto = require('crypto');

class AgentTaskService {
  constructor() {
    this.tasks = new Map();
  }

  createTask(commandType, metadata = {}) {
    const prefix = String(commandType || 'task').replace(/\./g, '_');
    const taskId = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const task = {
      id: taskId,
      taskId,
      commandType,
      status: 'accepted',
      logs: [],
      logText: '',
      result: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...metadata,
    };
    this.tasks.set(taskId, task);
    return task;
  }

  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  appendLog(taskId, line) {
    const task = this.tasks.get(taskId);
    if (!task || !line) return null;
    task.logs.push(String(line));
    task.logText = task.logs.join('\n');
    task.updatedAt = new Date().toISOString();
    return task;
  }

  updateTask(taskId, patch = {}) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    if (Array.isArray(task.logs)) {
      task.logText = task.logs.join('\n');
    }
    return task;
  }

  applyCallback(taskId, payload = {}) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (payload.log) {
      String(payload.log)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => this.appendLog(taskId, line));
    }
    if (Array.isArray(payload.logs)) {
      payload.logs.forEach((line) => this.appendLog(taskId, line));
    }
    if (payload.status) task.status = payload.status;
    if (payload.result) task.result = payload.result;
    if (payload.errorMessage) task.errorMessage = payload.errorMessage;
    if (payload.error) task.errorMessage = payload.error;
    task.updatedAt = new Date().toISOString();
    task.logText = task.logs.join('\n');
    return task;
  }
}

module.exports = {
  AgentTaskService,
};
