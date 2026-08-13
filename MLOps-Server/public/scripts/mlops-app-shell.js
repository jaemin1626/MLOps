(function initializeAppShell(global) {
  'use strict';

  global.MLOps = global.MLOps || {};
  const { api } = global.MLOps;
  const { showToast } = global.MLOps.formatters;

  function handleError(error) {
    console.error(error);
    showToast(error?.message || '요청 처리 중 오류가 발생했습니다.', 'error');
  }

  function scrollContentToTop() {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }

  function navigateTo(pageId) {
    const targetLink = document.querySelector(`.sidebar-link[data-page="${pageId}"]`);
    document.querySelectorAll('.page-section').forEach((section) => section.classList.toggle('active', section.id === pageId));
    document.querySelectorAll('.sidebar-link').forEach((link) => link.classList.toggle('active', link.dataset.page === pageId));
    if (targetLink) {
      document.getElementById('pageTitle').textContent = targetLink.dataset.title;
      document.getElementById('pageSubtitle').textContent = targetLink.dataset.subtitle;
    }
    scrollContentToTop();
    window.location.hash = pageId === 'model-detail-page' && window.location.hash.includes('model-detail-page?')
      ? window.location.hash.slice(1)
      : pageId;
    if (pageId === 'data-browser-page') {
      global.MLOps.dataBrowserController.loadTree().catch(handleError);
    }
    if (pageId === 'vlm-tagging-page') {
      global.MLOps.vlmTaggingController.loadImages().catch(handleError);
    }
    if (pageId === 'dashboard-page') global.MLOps.dashboardController.load().catch(handleError);
    if (pageId === 'training-detector-settings-page' || pageId === 'training-vlm-settings-page') {
      global.MLOps.trainingSettingsController.onPageEnter(pageId);
    }
    if (pageId === 'training-settings-page') {
      navigateTo('training-detector-settings-page');
      return;
    }
    if (pageId === 'training-monitor-page') global.MLOps.trainingMonitorController.loadJobs().catch(handleError);
    if (pageId === 'model-list-page') {
      global.MLOps.modelListController.load().catch(handleError);
    }
    if (pageId === 'model-detail-page') {
      global.MLOps.modelDetailController.restoreFromHash();
    }
    if (pageId === 'model-export-page') {
      Promise.all([
        global.MLOps.modelExportController.loadRunFolders(),
        global.MLOps.modelExportController.loadExports(),
      ]).catch(handleError);
    }
    if (pageId === 'connections-page') {
      global.MLOps.connectionsController.load().catch(handleError);
    }
  }

  async function initialize() {
    global.MLOps.handleError = handleError;
    global.MLOps.navigateTo = navigateTo;

    document.querySelectorAll('.sidebar-link[data-page]').forEach((link) => {
      link.addEventListener('click', () => navigateTo(link.dataset.page));
    });

    document.getElementById('openConnectionsPageButton')?.addEventListener('click', () => {
      navigateTo('connections-page');
    });

    try {
      global.MLOps.dashboardController.init();
      global.MLOps.dataBrowserController.init();
      global.MLOps.taggingController.init();
      global.MLOps.vlmTaggingController.init();
      global.MLOps.trainingSettingsController.init();
      global.MLOps.trainingMonitorController.init();
      global.MLOps.modelListController.init();
      global.MLOps.modelDetailController.init();
      global.MLOps.modelExportController.init();
      global.MLOps.connectionsController.init();
    } catch (error) {
      handleError(error);
    }

    try {
      const clientConfig = await api.get('/api/client-config');
      global.MLOps.clientConfig = clientConfig;
      if (clientConfig.activeConnection) {
        global.MLOps.connectionStore.syncActiveFromServer(clientConfig.activeConnection);
      }
      global.MLOps.connectionStore.setConnections(clientConfig.connections || []);
      const activeLabel = document.getElementById('trainingConnectionLabel');
      if (activeLabel) {
        const active = clientConfig.activeConnection;
        if (active) {
          activeLabel.textContent = `연결됨 · ${active.name}`;
          activeLabel.className = 'badge green';
        } else {
          activeLabel.textContent = '연결된 학습 서버 없음';
          activeLabel.className = 'badge orange';
        }
      }
      global.MLOps.dataBrowserController.configure(clientConfig);
      global.MLOps.taggingController.configure(clientConfig);
      global.MLOps.vlmTaggingController.configure(clientConfig);
      global.MLOps.trainingSettingsController.configure(clientConfig);
      global.MLOps.modelExportController.configure(clientConfig);
      const health = await api.get('/api/health');
      const statusBadge = document.getElementById('serverStatusBadge');
      const agent = health.trainingServer || {};
      const agentState = agent.agentState ? ` · agent ${agent.agentState}` : '';
      const waiting = agent.waitingForCommands ? ' · REST 대기' : '';
      statusBadge.textContent = `MLOps 연결됨 · ${clientConfig.trainingExecutionMode}${agentState}${waiting}`;
      statusBadge.className = agent.status === 'ok' ? 'badge green' : 'badge orange';
      statusBadge.title = agent.supportedCommands
        ? `학습 서버 명령: ${agent.supportedCommands.join(', ')}`
        : (agent.workspaceRoot || clientConfig.trainingServerBaseUrl || '');
    } catch (error) {
      const statusBadge = document.getElementById('serverStatusBadge');
      statusBadge.textContent = '서버 연결 실패';
      statusBadge.className = 'badge red';
      handleError(error);
    }

    await Promise.allSettled([
      global.MLOps.dashboardController.load(),
      global.MLOps.trainingMonitorController.loadJobs(),
      global.MLOps.modelListController.load(),
      global.MLOps.modelExportController.loadRunFolders(),
      global.MLOps.modelExportController.loadExports(),
    ]);

    const initialPage = window.location.hash.slice(1).split('?')[0];
    if (initialPage && document.getElementById(initialPage)) navigateTo(initialPage);

    setInterval(() => {
      if (document.getElementById('dashboard-page').classList.contains('active')) {
        global.MLOps.dashboardController.load().catch(() => {});
      }
    }, 2200);
  }

  document.addEventListener('DOMContentLoaded', () => initialize().catch(handleError));
})(window);
