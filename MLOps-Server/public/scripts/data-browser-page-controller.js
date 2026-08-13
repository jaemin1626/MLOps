(function initializeDataBrowserController(global) {
  'use strict';

  const DEFAULT_DATA_ROOT = '/workspace/dataset';
  const { api } = global.MLOps;
  const { escapeHtml, showToast } = global.MLOps.formatters;
  let selectedPath = null;
  let dataRootPath = DEFAULT_DATA_ROOT;

  function resolveDataRoot() {
    const input = document.getElementById('dataRootPathInput');
    const inputValue = input ? input.value.trim() : '';
    const configuredRoot = global.MLOps.clientConfig?.dataRoot || DEFAULT_DATA_ROOT;
    dataRootPath = inputValue || configuredRoot;
    if (input) {
      input.value = dataRootPath;
    }
    return dataRootPath;
  }

  function setLoadStatus(message, isError = false) {
    const hint = document.getElementById('eventFolderSearchHint');
    if (hint && message) {
      hint.textContent = message;
      hint.classList.toggle('error-text', isError);
    }
  }

  function renderTreeNode(node) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';
    const button = document.createElement('button');
    button.className = 'tree-button';
    button.type = 'button';
    button.dataset.path = node.path;
    button.innerHTML = `<svg class="icon"><use href="assets/icons/mlops-icons.svg#icon-folder"></use></svg><span>${escapeHtml(node.name)}</span>`;
    button.title = node.path;
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await selectFolder(node.path, node.name, button);
    });
    wrapper.appendChild(button);
    for (const child of node.children || []) wrapper.appendChild(renderTreeNode(child));
    return wrapper;
  }

  function highlightSelection(path, button) {
    document.querySelectorAll('.tree-button.selected, .event-folder-item.selected').forEach((item) => {
      item.classList.remove('selected');
    });
    if (button) {
      button.classList.add('selected');
      return;
    }
    const treeButton = document.querySelector(`.tree-button[data-path="${CSS.escape(path)}"]`);
    if (treeButton) treeButton.classList.add('selected');
  }

  async function selectFolder(path, title, button) {
    const folderPath = String(path || '').trim();
    if (!folderPath) {
      return;
    }
    selectedPath = folderPath;
    highlightSelection(folderPath, button);
    const useRecursive = folderPath !== dataRootPath;
    await loadFolderSummary(folderPath, title || folderPath.split('/').pop(), { recursive: useRecursive });
  }

  function renderEventFolders(eventFolders, hint = '') {
    const container = document.getElementById('eventFolderList');
    if (!container) {
      return;
    }
    const countElement = document.getElementById('eventFolderCount');
    if (countElement) {
      countElement.textContent = `${eventFolders.length}개`;
    }
    if (!eventFolders.length) {
      container.innerHTML = `<div class="muted">${escapeHtml(hint || '하위 폴더가 없습니다.')}</div>`;
      return;
    }
    container.innerHTML = eventFolders.map((folder) => `
      <button type="button" class="event-folder-item" data-path="${escapeHtml(folder.path)}" title="${escapeHtml(folder.path)}">
        <strong>${escapeHtml(folder.name)}</strong>
        <span class="event-folder-meta">${escapeHtml(folder.relativePath)}</span>
      </button>
    `).join('');
    container.querySelectorAll('.event-folder-item').forEach((item) => {
      item.addEventListener('click', () => {
        const folderPath = item.getAttribute('data-path') || '';
        selectFolder(folderPath, item.querySelector('strong')?.textContent, item).catch(global.MLOps.handleError);
      });
    });
  }

  async function searchEventFolders(query = '', options = {}) {
    const rootPath = resolveDataRoot();
    const result = await api.post('/api/data/event-folders', {
      path: rootPath,
      query,
      immediateOnly: options.immediateOnly !== false,
    });
    renderEventFolders(result.eventFolders || [], result.hint || '');
    return result;
  }

  async function refreshTreeView() {
    const rootPath = resolveDataRoot();
    const result = await api.post('/api/data/tree', { path: rootPath });
    const container = document.getElementById('dataFolderTree');
    if (container) {
      container.innerHTML = '';
      container.appendChild(renderTreeNode(result.tree));
    }
    const searchQuery = document.getElementById('eventFolderSearchInput')?.value.trim() || '';
    return searchEventFolders(searchQuery, { immediateOnly: !searchQuery });
  }

  async function loadTree() {
    const loadButton = document.getElementById('dataTreeLoadButton');
    if (loadButton) {
      loadButton.disabled = true;
    }
    try {
      setLoadStatus('데이터를 불러오는 중입니다...');
      showToast('데이터 불러오는 중...');
      const eventResult = await refreshTreeView();
      const message = eventResult.count
        ? `데이터를 불러왔습니다. 하위 폴더 ${eventResult.count}개`
        : (eventResult.hint || '하위 폴더가 없습니다. 학습 서버 동기화를 눌러보세요.');
      setLoadStatus(message, false);
      showToast(message);
      return eventResult;
    } catch (error) {
      setLoadStatus(error.message || '데이터를 불러오지 못했습니다.', true);
      throw error;
    } finally {
      if (loadButton) {
        loadButton.disabled = false;
      }
    }
  }

  async function syncFromTrainingServer() {
    const syncButton = document.getElementById('dataSyncButton');
    if (syncButton) {
      syncButton.disabled = true;
    }
    try {
      setLoadStatus('학습 서버 dataset 동기화 중...');
      showToast('학습 서버 dataset 동기화 중...');
      try {
        await api.post('/api/data/sync', { timeoutMs: 60000 });
      } catch (syncError) {
        showToast(syncError.message || '동기화 실패. 캐시 데이터를 표시합니다.');
      }
      const eventResult = await refreshTreeView();
      const message = eventResult.count
        ? `동기화 완료. 하위 폴더 ${eventResult.count}개`
        : '동기화 완료. 하위 폴더가 없습니다.';
      setLoadStatus(message, false);
      showToast(message);
      return eventResult;
    } finally {
      if (syncButton) {
        syncButton.disabled = false;
      }
    }
  }

  async function loadFolderSummary(path, title, options = {}) {
    const folderPath = String(path || '').trim();
    if (!folderPath) {
      return;
    }
    const summary = await api.post('/api/data/summary', {
      path: folderPath,
      recursive: Boolean(options.recursive),
    });
    document.getElementById('selectedFolderTitle').textContent = `이미지 현황 · ${title || summary.folderName}`;
    document.getElementById('selectedFolderPath').textContent = summary.folderPath;
    const totalImages = summary.imageCount || summary.totalImages || 0;
    const labeledImages = summary.matchedImageCount || 0;
    const unlabeledImages = summary.unlabeledImageCount || Math.max(0, totalImages - labeledImages);
    const metrics = [
      ['전체 이미지', totalImages],
      ['라벨 있음', labeledImages],
      ['라벨 없음', unlabeledImages],
    ];
    document.getElementById('dataSummaryGrid').innerHTML = metrics.map(([label, value]) => (
      `<div class="summary-item"><span>${label}</span><strong>${value}</strong></div>`
    )).join('');
    const thumbnails = document.getElementById('dataThumbnailGrid');
    if (!summary.images.length) {
      thumbnails.innerHTML = '<div class="muted">선택한 폴더에 지원 이미지가 없습니다.</div>';
      return;
    }
    thumbnails.innerHTML = summary.images.map((image) => `
      <div class="thumbnail-card">
        <img class="thumbnail-image" loading="lazy" src="/api/data/image?path=${encodeURIComponent(image.path)}" alt="${escapeHtml(image.name)}">
        <div class="thumbnail-caption">
          <span class="badge ${image.hasLabel ? 'green' : 'orange'}">${image.hasLabel ? '라벨 있음' : '라벨 없음'}</span>
        </div>
      </div>
    `).join('');
  }

  function init() {
    resolveDataRoot();
    const loadButton = document.getElementById('dataTreeLoadButton');
    const syncButton = document.getElementById('dataSyncButton');
    const searchButton = document.getElementById('eventFolderSearchButton');
    const searchInput = document.getElementById('eventFolderSearchInput');

    loadButton?.addEventListener('click', () => loadTree().catch(global.MLOps.handleError));
    syncButton?.addEventListener('click', () => syncFromTrainingServer().catch(global.MLOps.handleError));
    searchButton?.addEventListener('click', () => {
      resolveDataRoot();
      searchEventFolders(searchInput?.value.trim() || '', { immediateOnly: false }).catch(global.MLOps.handleError);
    });
    searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchButton?.click();
      }
    });
  }

  function configure(clientConfig) {
    dataRootPath = clientConfig?.dataRoot || DEFAULT_DATA_ROOT;
    const input = document.getElementById('dataRootPathInput');
    if (input) {
      input.value = dataRootPath;
    }
  }

  global.MLOps.dataBrowserController = { init, configure, loadTree, getSelectedPath: () => selectedPath };
})(window);
