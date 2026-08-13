(function initializeModelExportController(global) {
  'use strict';

  const { api } = global.MLOps;
  const { formToObject, escapeHtml, formatDate, badgeForStatus, showToast, formatBytes } = global.MLOps.formatters;
  const INITIAL_VISIBLE = 5;
  const LOAD_MORE_STEP = 5;
  let exports = [];
  let visibleExportCount = INITIAL_VISIBLE;
  let runFolders = [];
  let ptFiles = [];
  let runsRoot = 'detector/runs';
  let selectedExportId = '';
  let selectedExportStatus = '';
  let logSource = null;
  let pollTimer = null;

  function renderRunFolders() {
    const select = document.getElementById('exportRunFolderSelect');
    const previous = select.value;
    select.innerHTML = '<option value="">가중치 폴더를 선택하세요.</option>'
      + runFolders.map((folder) => `<option value="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</option>`).join('');
    if (runFolders.some((folder) => folder.name === previous)) {
      select.value = previous;
    }
  }

  function renderPtFiles() {
    const select = document.getElementById('exportSourceModelSelect');
    const previous = select.value;
    if (!ptFiles.length) {
      select.disabled = true;
      select.innerHTML = '<option value="">가중치 폴더 Load 후 .pt 파일을 선택하세요.</option>';
      return;
    }
    select.disabled = false;
    select.innerHTML = '<option value="">.pt 파일을 선택하세요.</option>'
      + ptFiles.map((file) => `<option value="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)} · ${escapeHtml(file.relativePath)} (${formatBytes(file.sizeBytes)})</option>`).join('');
    if (ptFiles.some((file) => file.relativePath === previous)) {
      select.value = previous;
    } else if (ptFiles.some((file) => file.name === 'best.pt')) {
      select.value = ptFiles.find((file) => file.name === 'best.pt').relativePath;
    }
  }

  async function loadRunFolders() {
    const result = await api.get('/api/model-management/runs/folders');
    runsRoot = result.runsRoot || runsRoot;
    runFolders = result.folders || [];
    document.getElementById('exportRunsRootHint').textContent = `가중치 root: ${runsRoot}${result.hint ? ` · ${result.hint}` : ''}`;
    renderRunFolders();
  }

  async function loadPtFiles() {
    const folderName = document.getElementById('exportRunFolderSelect').value;
    if (!folderName) {
      showToast('가중치 폴더를 먼저 선택하세요.', 'error');
      return;
    }
    const button = document.getElementById('exportLoadPtButton');
    button.disabled = true;
    try {
      const result = await api.get(`/api/model-management/runs/${encodeURIComponent(folderName)}/pt-files`);
      ptFiles = result.files || [];
      renderPtFiles();
      if (!ptFiles.length) {
        showToast(`${folderName} 폴더에 .pt 파일이 없습니다.`, 'error');
      } else {
        showToast(`.pt 파일 ${ptFiles.length}개를 불러왔습니다.`);
      }
    } finally {
      button.disabled = false;
    }
  }

  function parameters() {
    return formToObject(document.getElementById('modelExportForm'));
  }

  async function preview() {
    const params = parameters();
    if (!params.sourcePtPath) {
      throw new Error('가중치 폴더를 Load 한 뒤 .pt 파일을 선택하세요.');
    }
    const result = await api.post('/api/model-management/exports/command-preview', params);
    document.getElementById('exportCommandPreview').textContent = result.command;
    return result;
  }

  async function start() {
    const params = parameters();
    if (!params.sourcePtPath) {
      throw new Error('가중치 폴더를 Load 한 뒤 .pt 파일을 선택하세요.');
    }
    const button = document.getElementById('exportStartButton');
    button.disabled = true;
    try {
      const result = await api.post('/api/model-management/exports', params);
      document.getElementById('exportCommandPreview').textContent = result.command;
      showToast(`ONNX Export를 시작했습니다: ${result.modelName}`);
      selectedExportId = result.id;
      selectedExportStatus = result.status || 'running';
      await loadExports(result.id);
      openLog(result.id, true);
    } finally {
      button.disabled = false;
    }
  }

  function exportDownloadUrl(exportId) {
    return `/api/model-management/exports/${encodeURIComponent(exportId)}/download`;
  }

  function renderDownloadAction(item) {
    if (item.status !== 'completed') {
      return '<span class="muted">-</span>';
    }
    const fileName = escapeHtml(item.outputOnnxFileName || 'model.onnx');
    return `<a class="button small" href="${exportDownloadUrl(item.id)}" download="${fileName}">다운로드</a>`;
  }

  function updateDownloadButton() {
    const button = document.getElementById('exportDownloadButton');
    if (!button) return;
    const selected = exports.find((item) => item.id === selectedExportId);
    if (selected?.status === 'completed') {
      button.classList.remove('hidden');
      button.href = exportDownloadUrl(selected.id);
      button.download = selected.outputOnnxFileName || 'model.onnx';
      return;
    }
    button.classList.add('hidden');
    button.removeAttribute('href');
    button.removeAttribute('download');
  }

  function updateExportHistoryFooterButtons() {
    const loadMoreButton = document.getElementById('exportHistoryLoadMoreButton');
    const collapseButton = document.getElementById('exportHistoryCollapseButton');
    if (!loadMoreButton || !collapseButton) return;
    const remaining = Math.max(0, exports.length - visibleExportCount);
    loadMoreButton.classList.toggle('hidden', remaining === 0);
    collapseButton.classList.toggle('hidden', visibleExportCount <= INITIAL_VISIBLE);
    if (remaining > 0) {
      loadMoreButton.textContent = `더보기 (${Math.min(LOAD_MORE_STEP, remaining)}개)`;
    }
    collapseButton.textContent = `접기 (${visibleExportCount - INITIAL_VISIBLE}개)`;
  }

  function renderExports() {
    const body = document.getElementById('exportHistoryTableBody');
    const visibleExports = exports.slice(0, visibleExportCount);
    body.innerHTML = visibleExports.length ? visibleExports.map((item) => `<tr>
      <td>${escapeHtml(item.modelName)}</td><td>${escapeHtml(item.sourcePtFileName)}</td><td>${escapeHtml(item.outputOnnxFileName)}</td>
      <td>${formatDate(item.completedAt || item.startedAt)}</td><td>${badgeForStatus(item.status)}</td>
      <td>${renderDownloadAction(item)}</td>
    </tr>`).join('') : '<tr><td class="empty-cell" colspan="6">ONNX Export 이력이 없습니다.</td></tr>';
    updateExportHistoryFooterButtons();
    updateDownloadButton();
    const select = document.getElementById('exportLogSelect');
    select.innerHTML = '<option value="">작업을 선택하세요.</option>' + exports.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.modelName)} · ${escapeHtml(item.status)}</option>`).join('');
    select.value = selectedExportId;
  }

  function openLog(exportId, reset = true) {
    if (logSource) logSource.close();
    const consoleElement = document.getElementById('exportLiveLog');
    if (reset) consoleElement.textContent = '';
    if (!exportId) {
      consoleElement.textContent = 'Export 작업을 선택하세요.';
      return;
    }
    logSource = api.openEventStream(`/api/model-management/exports/${encodeURIComponent(exportId)}/log-stream`, {
      onLog: ({ text }) => {
        consoleElement.textContent += text;
        consoleElement.scrollTop = consoleElement.scrollHeight;
      },
    });
  }

  function selectExport(exportId) {
    selectedExportId = exportId;
    selectedExportStatus = exports.find((item) => item.id === exportId)?.status || '';
    document.getElementById('exportLogSelect').value = exportId;
    updateDownloadButton();
    openLog(exportId, true);
  }

  function schedulePolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!document.getElementById('model-export-page').classList.contains('active')) return;
      loadExports().catch(() => {});
    }, 900);
  }

  async function loadExports(preferredId = '') {
    const result = await api.get('/api/model-management/exports');
    exports = result.exports || [];
    if (preferredId) selectedExportId = preferredId;
    if (!selectedExportId && exports.length) selectedExportId = exports[0].id;
    const selected = exports.find((item) => item.id === selectedExportId);
    const previousStatus = selectedExportStatus;
    if (selected) selectedExportStatus = selected.status;
    renderExports();
    if (selected && !logSource) {
      openLog(selectedExportId, true);
    } else if (selected && previousStatus !== selected.status) {
      renderExports();
    }
  }

  function init() {
    document.getElementById('exportPreviewButton').addEventListener('click', () => preview().catch(global.MLOps.handleError));
    document.getElementById('exportStartButton').addEventListener('click', () => start().catch(global.MLOps.handleError));
    document.getElementById('exportLoadPtButton').addEventListener('click', () => loadPtFiles().catch(global.MLOps.handleError));
    document.getElementById('exportRunFolderSelect').addEventListener('change', () => {
      ptFiles = [];
      renderPtFiles();
    });
    document.getElementById('exportLogSelect').addEventListener('change', (event) => selectExport(event.target.value));
    document.getElementById('exportHistoryLoadMoreButton').addEventListener('click', () => {
      visibleExportCount = Math.min(exports.length, visibleExportCount + LOAD_MORE_STEP);
      renderExports();
    });
    document.getElementById('exportHistoryCollapseButton').addEventListener('click', () => {
      visibleExportCount = INITIAL_VISIBLE;
      renderExports();
    });
    schedulePolling();
  }

  function configure(clientConfig) {
    document.getElementById('exportOutputDirectory').value = clientConfig.exportOutputRoot || 'detector/exports';
    runsRoot = clientConfig.trainingRunsRoot || runsRoot;
    document.getElementById('exportRunsRootHint').textContent = `가중치 root: ${runsRoot}`;
  }

  global.MLOps.modelExportController = {
    init,
    configure,
    loadRunFolders,
    loadExports,
    preview,
    start,
  };
})(window);
