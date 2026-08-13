(function initializeConnectionStore(global) {
  'use strict';

  const STORAGE_KEY = 'mlops.selectedConnectionId';
  let connections = [];
  let activeConnection = null;
  let selectedConnectionId = sessionStorage.getItem(STORAGE_KEY) || '';

  function setConnections(list) {
    connections = Array.isArray(list) ? list : [];
    const activeFromList = connections.find((item) => item.is_active);
    if (activeFromList) {
      syncActiveFromServer(activeFromList);
      return;
    }
    if (selectedConnectionId && !connections.some((item) => item.connection_id === selectedConnectionId)) {
      selectedConnectionId = '';
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  function syncActiveFromServer(active) {
    if (!active || !active.connection_id) {
      activeConnection = null;
      selectedConnectionId = '';
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    activeConnection = active;
    selectedConnectionId = active.connection_id;
    sessionStorage.setItem(STORAGE_KEY, selectedConnectionId);
  }

  function getConnections() {
    return connections.slice();
  }

  function getActiveConnection() {
    return activeConnection;
  }

  function getSelectedId() {
    return activeConnection?.connection_id || selectedConnectionId || '';
  }

  function getSelectedConnection() {
    if (activeConnection) {
      return activeConnection;
    }
    return connections.find((item) => item.connection_id === selectedConnectionId) || null;
  }

  function selectConnection(connectionId) {
    const activeId = getSelectedId();
    if (activeId && activeId !== connectionId) {
      throw new Error('다른 학습 서버가 연결 중입니다. Connection 관리에서 SSH 연결로 전환하세요.');
    }
    if (!connections.some((item) => item.connection_id === connectionId)) {
      throw new Error('선택한 학습 서버 Connection을 찾을 수 없습니다.');
    }
    selectedConnectionId = connectionId;
    sessionStorage.setItem(STORAGE_KEY, selectedConnectionId);
  }

  function appendConnectionQuery(url) {
    const connectionId = getSelectedId();
    if (!connectionId) {
      return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}connection_id=${encodeURIComponent(connectionId)}`;
  }

  function withConnectionBody(body) {
    const payload = body && typeof body === 'object' ? { ...body } : {};
    const connectionId = getSelectedId();
    if (connectionId) {
      payload.connection_id = connectionId;
    }
    return payload;
  }

  global.MLOps = global.MLOps || {};
  global.MLOps.connectionStore = {
    setConnections,
    syncActiveFromServer,
    getConnections,
    getActiveConnection,
    getSelectedId,
    getSelectedConnection,
    selectConnection,
    appendConnectionQuery,
    withConnectionBody,
  };
})(window);
