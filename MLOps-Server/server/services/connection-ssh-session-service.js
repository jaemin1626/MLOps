'use strict';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

class ConnectionSshSessionService {
  constructor() {
    this.sessions = new Map();
    this.activeConnectionId = null;
  }

  setSession(connectionId, credentials = {}) {
    const id = String(connectionId || '').trim();
    if (!id) {
      return null;
    }
    const session = {
      host: String(credentials.host || '').trim(),
      user: String(credentials.user || credentials.ssh_user || '').trim(),
      password: String(credentials.password || credentials.ssh_password || ''),
      authenticatedAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(id, session);
    return session;
  }

  activateExclusive(connectionId, credentials = {}) {
    const id = String(connectionId || '').trim();
    if (!id) {
      return { session: null, previousConnectionId: this.activeConnectionId };
    }
    const previousConnectionId = this.activeConnectionId && this.activeConnectionId !== id
      ? this.activeConnectionId
      : null;
    this.sessions.clear();
    this.activeConnectionId = id;
    const session = this.setSession(id, credentials);
    return { session, previousConnectionId };
  }

  getActiveConnectionId() {
    const activeId = String(this.activeConnectionId || '').trim();
    if (!activeId) {
      return null;
    }
    if (!this.getSession(activeId)) {
      this.activeConnectionId = null;
      return null;
    }
    return activeId;
  }

  isActive(connectionId) {
    const activeId = this.getActiveConnectionId();
    return Boolean(activeId && activeId === String(connectionId || '').trim());
  }

  getSession(connectionId) {
    const session = this.sessions.get(String(connectionId || '').trim());
    if (!session) {
      return null;
    }
    if (Date.now() > session.expiresAt) {
      this.clearSession(connectionId);
      return null;
    }
    return session;
  }

  clearSession(connectionId) {
    const id = String(connectionId || '').trim();
    this.sessions.delete(id);
    if (this.activeConnectionId === id) {
      this.activeConnectionId = null;
    }
  }

  disconnectAll() {
    this.sessions.clear();
    this.activeConnectionId = null;
  }

  requireSession(connectionId) {
    const session = this.getSession(connectionId);
    if (!session) {
      const error = new Error('SSH 인증이 필요합니다. Connection 관리에서 다시 연결하세요.');
      error.statusCode = 401;
      throw error;
    }
    return session;
  }

  requireActiveSession() {
    const activeId = this.getActiveConnectionId();
    if (!activeId) {
      const error = new Error('연결된 학습 서버가 없습니다. Connection 관리에서 SSH 연결하세요.');
      error.statusCode = 401;
      throw error;
    }
    return {
      connectionId: activeId,
      session: this.requireSession(activeId),
    };
  }
}

module.exports = {
  ConnectionSshSessionService,
};
