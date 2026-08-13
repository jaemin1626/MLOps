'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../utils/atomic-json-file');
const { buildApiBaseUrl, loadConnectionConfig } = require('./connection-config-service');
const { verifySshCredentials } = require('../utils/ssh-auth');

const REGISTRY_VERSION = 1;

function createConnectionId() {
  return crypto.randomUUID();
}

function createConnectionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeConnection(record, options = {}) {
  if (!record) {
    return null;
  }
  const sshAuthenticated = Boolean(options.sshAuthenticated);
  return {
    connection_id: record.connection_id,
    name: record.name,
    ssh_user: record.ssh_user || '',
    status: record.status || 'unknown',
    is_default: Boolean(record.is_default),
    is_active: Boolean(options.isActive),
    ssh_authenticated: sshAuthenticated,
  };
}

function stripSensitiveFields(record) {
  if (!record) {
    return record;
  }
  const { ssh_password: _removed, ...safeRecord } = record;
  return safeRecord;
}

class TrainingConnectionRegistryService {
  constructor(options = {}) {
    this.registryFile = options.registryFile
      || path.join(options.workspaceRoot || path.resolve(__dirname, '../../workspace'), 'connections', 'registry.json');
    this.migrated = false;
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
    this.bootstrapFromLegacyConfig();
  }

  readRegistry() {
    const registry = readJsonFile(this.registryFile, null);
    if (!registry || !Array.isArray(registry.connections)) {
      return { version: REGISTRY_VERSION, connections: [] };
    }
    let changed = false;
    registry.connections = registry.connections
      .filter((item) => !/^Test Server /.test(String(item.name || '')))
      .map((item) => {
        if (item.ssh_password) {
          changed = true;
          return stripSensitiveFields(item);
        }
        return item;
      });
    if (changed) {
      this.writeRegistry(registry);
    }
    return registry;
  }

  writeRegistry(registry) {
    writeJsonFileAtomic(this.registryFile, {
      version: REGISTRY_VERSION,
      updatedAt: new Date().toISOString(),
      connections: registry.connections.map(stripSensitiveFields),
    });
  }

  bootstrapFromLegacyConfig() {
    const registry = this.readRegistry();
    if (registry.connections.length) {
      return;
    }

    let legacy;
    try {
      legacy = loadConnectionConfig();
    } catch (_error) {
      return;
    }

    const host = String(legacy.trainingServer.host || legacy.ssh.host || '').trim();
    if (!host) {
      return;
    }

    const now = new Date().toISOString();
    const token = String(legacy.trainingServer.authToken || '').trim() || createConnectionToken();
    const connection = {
      connection_id: createConnectionId(),
      name: '기본 학습 서버',
      host,
      detector_port: Number(legacy.trainingServer.agentPort || 9010),
      vlm_port: Number(legacy.vlmTrainingServer.agentPort || 9011),
      token,
      ssh_user: legacy.ssh.user || '',
      remote_workspace_root: legacy.ssh.remoteWorkspaceRoot || '',
      remote_dataset_path: legacy.ssh.remoteDatasetPath || '',
      workspace_root: legacy.trainingServer.workspaceRoot || '/workspace',
      status: 'unknown',
      last_seen: null,
      is_default: true,
      legacy_paths: true,
      created_at: now,
      updated_at: now,
    };

    this.writeRegistry({ connections: [connection] });
    this.migrated = true;
    console.log(`[ConnectionRegistry] legacy mlops-connection.json -> default connection (${connection.connection_id})`);
  }

  listConnections(options = {}) {
    const sshSessionService = options.sshSessionService || null;
    const activeConnectionId = sshSessionService?.getActiveConnectionId?.() || null;
    return this.readRegistry().connections.map((record) => sanitizeConnection(
      record,
      {
        sshAuthenticated: sshSessionService?.isActive?.(record.connection_id),
        isActive: record.connection_id === activeConnectionId,
      },
    ));
  }

  listConnectionsInternal() {
    return this.readRegistry().connections;
  }

  getById(connectionId) {
    const id = String(connectionId || '').trim();
    if (!id) {
      return null;
    }
    return this.readRegistry().connections.find((item) => item.connection_id === id) || null;
  }

  getDefaultConnection() {
    const connections = this.readRegistry().connections;
    if (!connections.length) {
      return null;
    }
    return connections.find((item) => item.is_default) || connections[0];
  }

  requireById(connectionId) {
    const connection = connectionId
      ? this.getById(connectionId)
      : this.getDefaultConnection();
    if (!connection) {
      const error = new Error(connectionId
        ? `학습 서버 Connection을 찾을 수 없습니다: ${connectionId}`
        : '등록된 학습 서버 Connection이 없습니다.');
      error.statusCode = 404;
      throw error;
    }
    return connection;
  }

  createConnection(input = {}, options = {}) {
    const name = String(input.name || '').trim();
    const host = String(input.host || '').trim();
    const sshUser = String(input.ssh_user || input.ssh?.user || '').trim();
    const sshPassword = String(input.ssh_password || input.ssh?.password || '');

    if (!name) {
      throw Object.assign(new Error('Connection 이름은 필수입니다.'), { statusCode: 400 });
    }
    if (!host) {
      throw Object.assign(new Error('학습 서버 host는 필수입니다.'), { statusCode: 400 });
    }
    if (!sshUser || !sshPassword) {
      throw Object.assign(new Error('SSH User와 SSH Password는 필수입니다.'), { statusCode: 400 });
    }

    verifySshCredentials({ host, user: sshUser, password: sshPassword });

    const now = new Date().toISOString();
    const connection = {
      connection_id: createConnectionId(),
      name,
      host,
      detector_port: Number(input.detector_port || 9010),
      vlm_port: Number(input.vlm_port || 9011),
      token: createConnectionToken(),
      ssh_user: sshUser,
      remote_workspace_root: String(
        input.remote_workspace_root
        || input.ssh?.remoteWorkspaceRoot
        || '',
      ).replace(/\/+$/, ''),
      remote_dataset_path: String(
        input.remote_dataset_path
        || input.ssh?.remoteDatasetPath
        || '',
      ).replace(/\/+$/, ''),
      workspace_root: String(input.workspace_root || '/workspace').replace(/\/+$/, ''),
      status: 'unknown',
      last_seen: null,
      is_default: false,
      legacy_paths: false,
      created_at: now,
      updated_at: now,
    };

    if (!connection.remote_dataset_path) {
      connection.remote_dataset_path = `${connection.remote_workspace_root}/dataset`;
    }

    const registry = this.readRegistry();
    registry.connections.push(connection);
    this.writeRegistry(registry);

    if (options.sshSessionService) {
      options.sshSessionService.activateExclusive(connection.connection_id, {
        host: connection.host,
        user: connection.ssh_user,
        password: sshPassword,
      });
    }

    return sanitizeConnection(connection, {
      sshAuthenticated: true,
      isActive: true,
    });
  }

  authenticateConnection(connectionId, input = {}, options = {}) {
    const connection = this.getById(connectionId);
    if (!connection) {
      const error = new Error(`학습 서버 Connection을 찾을 수 없습니다: ${connectionId}`);
      error.statusCode = 404;
      throw error;
    }

    const sshUser = String(input.ssh_user || connection.ssh_user || '').trim();
    const sshPassword = String(input.ssh_password || input.ssh?.password || '');
    if (!sshUser || !sshPassword) {
      throw Object.assign(new Error('SSH User와 SSH Password는 필수입니다.'), { statusCode: 400 });
    }

    verifySshCredentials({
      host: connection.host,
      user: sshUser,
      password: sshPassword,
    });

    if (input.ssh_user && input.ssh_user !== connection.ssh_user) {
      this.updateConnection(connectionId, { ssh_user: sshUser }, { skipWritePassword: true });
    }

    if (options.sshSessionService) {
      options.sshSessionService.activateExclusive(connectionId, {
        host: connection.host,
        user: sshUser,
        password: sshPassword,
      });
    }

    return sanitizeConnection(this.getById(connectionId), {
      sshAuthenticated: true,
      isActive: true,
    });
  }

  updateConnection(connectionId, input = {}, options = {}) {
    const registry = this.readRegistry();
    const index = registry.connections.findIndex((item) => item.connection_id === connectionId);
    if (index < 0) {
      const error = new Error(`학습 서버 Connection을 찾을 수 없습니다: ${connectionId}`);
      error.statusCode = 404;
      throw error;
    }

    const current = registry.connections[index];
    const updated = {
      ...current,
      name: input.name !== undefined ? String(input.name || '').trim() : current.name,
      host: input.host !== undefined ? String(input.host || '').trim() : current.host,
      detector_port: input.detector_port !== undefined
        ? Number(input.detector_port || 9010)
        : current.detector_port,
      vlm_port: input.vlm_port !== undefined ? Number(input.vlm_port || 9011) : current.vlm_port,
      ssh_user: input.ssh_user !== undefined ? String(input.ssh_user || '').trim() : current.ssh_user,
      remote_workspace_root: input.remote_workspace_root !== undefined
        ? String(input.remote_workspace_root || '').replace(/\/+$/, '')
        : current.remote_workspace_root,
      remote_dataset_path: input.remote_dataset_path !== undefined
        ? String(input.remote_dataset_path || '').replace(/\/+$/, '')
        : current.remote_dataset_path,
      workspace_root: input.workspace_root !== undefined
        ? String(input.workspace_root || '/workspace').replace(/\/+$/, '')
        : current.workspace_root,
      updated_at: new Date().toISOString(),
    };

    if (!updated.name) {
      throw Object.assign(new Error('Connection 이름은 필수입니다.'), { statusCode: 400 });
    }
    if (!updated.host) {
      throw Object.assign(new Error('학습 서버 host는 필수입니다.'), { statusCode: 400 });
    }

    registry.connections[index] = updated;
    this.writeRegistry(registry);
    return sanitizeConnection(updated, {
      sshAuthenticated: Boolean(options.sshSessionService?.getSession(connectionId)),
    });
  }

  deleteConnection(connectionId, options = {}) {
    const registry = this.readRegistry();
    const index = registry.connections.findIndex((item) => item.connection_id === connectionId);
    if (index < 0) {
      const error = new Error(`학습 서버 Connection을 찾을 수 없습니다: ${connectionId}`);
      error.statusCode = 404;
      throw error;
    }

    const [removed] = registry.connections.splice(index, 1);
    if (removed.is_default && registry.connections.length) {
      registry.connections[0].is_default = true;
      registry.connections[0].updated_at = new Date().toISOString();
    }
    this.writeRegistry(registry);
    if (options.sshSessionService?.isActive?.(connectionId)) {
      options.sshSessionService.disconnectAll();
    } else {
      options.sshSessionService?.clearSession(connectionId);
    }
    return sanitizeConnection(removed);
  }

  updateConnectionStatus(connectionId, status, lastSeen = new Date().toISOString()) {
    const registry = this.readRegistry();
    const index = registry.connections.findIndex((item) => item.connection_id === connectionId);
    if (index < 0) {
      return null;
    }
    registry.connections[index] = {
      ...registry.connections[index],
      status,
      last_seen: lastSeen,
      updated_at: new Date().toISOString(),
    };
    this.writeRegistry(registry);
    return sanitizeConnection(registry.connections[index]);
  }

  buildAgentUrls(connection) {
    return {
      detectorUrl: buildApiBaseUrl({
        host: connection.host,
        agentPort: connection.detector_port,
      }, 9010),
      vlmUrl: buildApiBaseUrl({
        host: connection.host,
        agentPort: connection.vlm_port,
      }, 9011),
    };
  }

  buildDownloadConfig(connection, monitoringPublicBaseUrl) {
    return {
      connection_id: connection.connection_id,
      monitoring_server: String(monitoringPublicBaseUrl || '').replace(/\/$/, ''),
      token: connection.token,
    };
  }
}

module.exports = {
  TrainingConnectionRegistryService,
  sanitizeConnection,
};
