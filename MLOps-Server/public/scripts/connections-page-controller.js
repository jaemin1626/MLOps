(function initializeConnectionsPageController(global) {
  'use strict';

  const { api } = global.MLOps;
  const { showToast } = global.MLOps.formatters;
  const connectionStore = global.MLOps.connectionStore;

  const elements = {};
  let pendingConnectId = null;

  function statusBadge(status) {
    if (status === 'connected') return '<span class="badge green">● 연결됨</span>';
    if (status === 'error') return '<span class="badge red">● 오류</span>';
    return '<span class="badge orange">○ 대기</span>';
  }

  function authBadge(authenticated) {
    return authenticated
      ? '<span class="badge green">SSH 인증됨</span>'
      : '<span class="badge orange">SSH 인증 필요</span>';
  }

  async function loadConnections() {
    const payload = await api.get('/api/connections');
    connectionStore.setConnections(payload.connections || []);
    renderConnectionTable(payload.connections || []);
    renderTopbarSelector(payload.connections || []);
  }

  function renderTopbarActiveConnection(active) {
    const label = document.getElementById('trainingConnectionLabel');
    if (!label) return;
    if (!active) {
      label.textContent = '연결된 학습 서버 없음';
      label.className = 'badge orange';
      return;
    }
    label.textContent = `연결됨 · ${active.name}`;
    label.className = 'badge green';
    label.title = 'MLOps 전체에서 하나의 학습 서버만 사용할 수 있습니다.';
  }

  function renderTopbarSelector(connections) {
    renderTopbarActiveConnection(connections.find((item) => item.is_active) || connectionStore.getActiveConnection());
  }

  function renderConnectionTable(connections) {
    const tbody = elements.connectionTableBody;
    if (!tbody) return;
    if (!connections.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">등록된 학습 서버가 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = connections.map((item) => `
      <tr>
        <td>${item.name}</td>
        <td>${statusBadge(item.status)}</td>
        <td>${item.is_active ? '<span class="badge green">사용 중</span>' : authBadge(item.ssh_authenticated)}</td>
        <td>
          <div class="input-row">
            <button class="button small" data-action="connect" data-id="${item.connection_id}" data-ssh-user="${item.ssh_user || ''}">SSH 연결</button>
            <button class="button small" data-action="refresh" data-id="${item.connection_id}">상태 확인</button>
            <button class="button small" data-action="download" data-id="${item.connection_id}">JSON 다운로드</button>
            <button class="button small danger" data-action="delete" data-id="${item.connection_id}">삭제</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function openConnectModal(connectionId, sshUser = '') {
    pendingConnectId = connectionId || null;
    elements.connectionConnectModal.classList.remove('hidden');
    elements.connectionConnectUserInput.value = String(sshUser || '').trim()
      || elements.connectionSshUserInput.value.trim();
    elements.connectionConnectPasswordInput.value = '';
    elements.connectionConnectPasswordInput.focus();
  }

  function closeConnectModal() {
    pendingConnectId = null;
    elements.connectionConnectModal.classList.add('hidden');
    elements.connectionConnectPasswordInput.value = '';
  }

  function readSshCredentials(prefix = 'connection') {
    const userInput = prefix === 'connect'
      ? elements.connectionConnectUserInput
      : elements.connectionSshUserInput;
    const passwordInput = prefix === 'connect'
      ? elements.connectionConnectPasswordInput
      : elements.connectionSshPasswordInput;
    return {
      ssh_user: userInput.value.trim(),
      ssh_password: passwordInput.value,
    };
  }

  function activationMessage(result, fallback) {
    if (result?.switched && result?.previousConnectionId) {
      const previous = connectionStore.getConnections().find((item) => item.connection_id === result.previousConnectionId);
      return `기존 "${previous?.name || '학습 서버'}" 연결을 해제하고 "${result.connection?.name || '새 서버'}" 에 연결했습니다.`;
    }
    return fallback;
  }

  function activateConnection(result, fallbackMessage) {
    connectionStore.syncActiveFromServer(result.connection);
    renderTopbarActiveConnection(result.connection);
    showToast(activationMessage(result, fallbackMessage), 'success');
    closeConnectModal();
    window.location.reload();
  }

  async function createConnection() {
    const ssh = readSshCredentials('create');
    if (!ssh.ssh_user || !ssh.ssh_password) {
      throw new Error('SSH User와 SSH Password를 입력하세요.');
    }
    const payload = {
      name: elements.connectionNameInput.value.trim(),
      host: elements.connectionHostInput.value.trim(),
      detector_port: Number(elements.connectionDetectorPortInput.value || 9010),
      vlm_port: Number(elements.connectionVlmPortInput.value || 9011),
      remote_workspace_root: elements.connectionRemoteWorkspaceInput.value.trim(),
      ...ssh,
    };
    const result = await api.post('/api/connections', payload);
    await loadConnections();
    if (!result.connection?.connection_id) {
      throw new Error('Connection ID를 받지 못했습니다.');
    }
    activateConnection(result, 'SSH 인증 후 학습 서버를 등록하고 연결했습니다.');
  }

  async function connectExisting(connectionId) {
    const ssh = readSshCredentials('connect');
    if (!ssh.ssh_user || !ssh.ssh_password) {
      throw new Error('SSH User와 SSH Password를 입력하세요.');
    }
    const result = await api.post(`/api/connections/${encodeURIComponent(connectionId)}/connect`, ssh);
    await loadConnections();
    activateConnection(result, 'SSH 인증에 성공했습니다. 학습 서버에 연결합니다.');
  }

  async function downloadConfig(connectionId, sshUser = '') {
    openConnectModal(connectionId, sshUser);
    elements.connectionConnectConfirmButton.dataset.mode = 'download';
    showToast('JSON 다운로드를 위해 SSH 인증 정보를 입력하세요.', 'info');
  }

  async function performDownload(connectionId, ssh) {
    const payload = await api.post(`/api/connections/${encodeURIComponent(connectionId)}/config`, ssh);
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `connection-${connectionId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function refreshHealth(connectionId) {
    await api.post(`/api/connections/${encodeURIComponent(connectionId)}/refresh-health`, {});
    showToast('Connection 상태를 갱신했습니다.', 'success');
    await loadConnections();
  }

  async function deleteConnection(connectionId) {
    if (!window.confirm('이 Connection을 삭제하시겠습니까?')) {
      return;
    }
    await fetch(`/api/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        return payload;
      });
    showToast('Connection을 삭제했습니다.', 'success');
    await loadConnections();
  }

  function bindEvents() {
    elements.connectionCreateForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      createConnection().catch((error) => {
        console.error(error);
        showToast(error.message, 'error');
      });
    });

    elements.connectionTableBody?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const connectionId = button.dataset.id;
      const action = button.dataset.action;
      if (action === 'connect') {
        elements.connectionConnectConfirmButton.dataset.mode = 'connect';
        openConnectModal(connectionId, button.dataset.sshUser || '');
      } else if (action === 'refresh') {
        refreshHealth(connectionId).catch((error) => showToast(error.message, 'error'));
      } else if (action === 'download') {
        downloadConfig(connectionId, button.dataset.sshUser || '').catch((error) => showToast(error.message, 'error'));
      } else if (action === 'delete') {
        deleteConnection(connectionId).catch((error) => showToast(error.message, 'error'));
      }
    });

    elements.connectionConnectCloseButton?.addEventListener('click', closeConnectModal);
    elements.connectionConnectConfirmButton?.addEventListener('click', () => {
      if (!pendingConnectId) return;
      const ssh = readSshCredentials('connect');
      const mode = elements.connectionConnectConfirmButton.dataset.mode || 'connect';
      const task = mode === 'download'
        ? performDownload(pendingConnectId, ssh)
        : connectExisting(pendingConnectId);
      task
        .then(() => {
          if (mode === 'download') {
            showToast('Connection JSON을 다운로드했습니다.', 'success');
            closeConnectModal();
          }
        })
        .catch((error) => showToast(error.message, 'error'));
    });

    document.getElementById('openConnectionsPageButton')?.addEventListener('click', () => {
      global.MLOps.navigateTo('connections-page');
    });
  }

  function init() {
    elements.connectionCreateForm = document.getElementById('connectionCreateForm');
    elements.connectionNameInput = document.getElementById('connectionNameInput');
    elements.connectionHostInput = document.getElementById('connectionHostInput');
    elements.connectionDetectorPortInput = document.getElementById('connectionDetectorPortInput');
    elements.connectionVlmPortInput = document.getElementById('connectionVlmPortInput');
    elements.connectionSshUserInput = document.getElementById('connectionSshUserInput');
    elements.connectionSshPasswordInput = document.getElementById('connectionSshPasswordInput');
    elements.connectionRemoteWorkspaceInput = document.getElementById('connectionRemoteWorkspaceInput');
    elements.connectionTableBody = document.getElementById('connectionTableBody');
    elements.connectionConnectModal = document.getElementById('connectionConnectModal');
    elements.connectionConnectUserInput = document.getElementById('connectionConnectUserInput');
    elements.connectionConnectPasswordInput = document.getElementById('connectionConnectPasswordInput');
    elements.connectionConnectCloseButton = document.getElementById('connectionConnectCloseButton');
    elements.connectionConnectConfirmButton = document.getElementById('connectionConnectConfirmButton');
    bindEvents();
  }

  global.MLOps.connectionsController = {
    init,
    load: loadConnections,
  };
})(window);
