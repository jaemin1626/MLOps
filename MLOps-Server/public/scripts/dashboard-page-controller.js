(function initializeDashboardController(global) {
  'use strict';

  const { api } = global.MLOps;
  const { formatBytes, formatDate, escapeHtml, badgeForStatus } = global.MLOps.formatters;
  let selectedLogJobId = '';
  let selectedLogJobStatus = '';
  let logSource = null;
  let latestJobs = [];

  function progressCell(job) {
    const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
    return `<div class="progress-cell"><span>${progress.toFixed(0)}%</span><div class="progress"><div class="progress-bar" style="width:${progress}%"></div></div></div>`;
  }

  function renderJobs(jobs) {
    const body = document.getElementById('dashboardJobTableBody');
    if (!jobs.length) {
      body.innerHTML = '<tr><td class="empty-cell" colspan="7">학습 작업이 없습니다.</td></tr>';
      return;
    }
    body.innerHTML = jobs.slice(0, 6).map((job) => `<tr>
      <td title="${escapeHtml(job.name)}">${escapeHtml(job.name)}</td>
      <td>${job.trainingType === 'vlm' ? '<span class="badge purple">VLM</span>' : '<span class="badge green">검출기</span>'}</td>
      <td>${formatDate(job.startedAt)}</td>
      <td>${job.epoch ?? 0} / ${job.totalEpoch ?? '-'}</td>
      <td>${job.loss ?? '-'}</td>
      <td>${progressCell(job)}</td>
      <td>${badgeForStatus(job.status)}</td>
    </tr>`).join('');
  }

  function renderExports(exports) {
    const body = document.getElementById('dashboardExportTableBody');
    if (!exports.length) {
      body.innerHTML = '<tr><td class="empty-cell" colspan="7">ONNX Export 이력이 없습니다.</td></tr>';
      return;
    }
    body.innerHTML = exports.slice(0, 5).map((item) => `<tr>
      <td>${escapeHtml(item.modelName)}</td>
      <td>${escapeHtml(item.modelType)}</td>
      <td>${escapeHtml(item.modelVersion || '-')}</td>
      <td>${escapeHtml(item.sourcePtFileName || '-')}</td>
      <td>${escapeHtml(item.outputOnnxFileName)}</td>
      <td>${formatDate(item.completedAt || item.startedAt)}</td>
      <td>${badgeForStatus(item.status)}</td>
    </tr>`).join('');
  }

  function renderDistribution(distribution) {
    const entries = [
      ['running', '학습 중', '#357cf4'],
      ['completed', '학습 완료', '#4ac979'],
      ['waiting', '실행 대기', '#f3aa34'],
      ['failed', '학습 실패', '#e84b3c'],
      ['unknown', '확인 불가', '#aab4c2'],
    ];
    const total = entries.reduce((sum, [key]) => sum + Number(distribution[key] || 0), 0);
    let cursor = 0;
    const gradientParts = entries.map(([key, _label, color]) => {
      const start = cursor;
      cursor += total > 0 ? (Number(distribution[key] || 0) / total) * 100 : 0;
      return `${color} ${start}% ${cursor}%`;
    });
    document.getElementById('dashboardDonut').style.background = total ? `conic-gradient(${gradientParts.join(',')})` : '#e7ebf1';
    document.getElementById('dashboardTotalJobs').textContent = `${total}건`;
    document.getElementById('dashboardLegend').innerHTML = entries.map(([key, label, color]) => {
      const count = Number(distribution[key] || 0);
      const percent = total ? Math.round((count / total) * 100) : 0;
      return `<div class="legend-row"><span class="legend-dot" style="background:${color}"></span><span>${label} (${count})</span><strong>${percent}%</strong></div>`;
    }).join('');
  }

  function openLogStream(jobId, fallbackText = '') {
    if (logSource) {
      logSource.close();
      logSource = null;
    }
    const consoleElement = document.getElementById('dashboardLatestLog');
    consoleElement.textContent = fallbackText || '';
    if (!jobId) {
      consoleElement.textContent = '학습 로그가 없습니다.';
      return;
    }
    consoleElement.textContent = '';
    logSource = api.openEventStream(`/api/training/jobs/${encodeURIComponent(jobId)}/log-stream`, {
      onLog: ({ text }) => {
        consoleElement.textContent += text;
        consoleElement.scrollTop = consoleElement.scrollHeight;
      },
    });
  }

  function renderLogSelector(jobs, latestLog) {
    latestJobs = jobs;
    const select = document.getElementById('dashboardLogJobSelect');
    if (!selectedLogJobId && jobs.length) selectedLogJobId = jobs[0].id;
    if (selectedLogJobId && !jobs.some((job) => job.id === selectedLogJobId)) selectedLogJobId = jobs[0]?.id || '';
    select.innerHTML = '<option value="">학습 작업을 선택하세요.</option>' + jobs.map((job) => `<option value="${escapeHtml(job.id)}">${escapeHtml(job.name)} · ${escapeHtml(job.status)}</option>`).join('');
    select.value = selectedLogJobId;
    const selected = jobs.find((job) => job.id === selectedLogJobId);
    const fallback = latestLog?.jobId === selectedLogJobId ? latestLog.text : '';
    if (selected && (selected.status !== selectedLogJobStatus || !logSource)) {
      selectedLogJobStatus = selected.status;
      openLogStream(selectedLogJobId, fallback);
    } else if (!selected) {
      openLogStream('', latestLog?.text || '');
    }
  }

  async function load() {
    const summary = await api.get('/api/dashboard');
    const { cards } = summary;
    document.getElementById('metricRunning').textContent = cards.runningTraining;
    document.getElementById('metricCompleted').textContent = cards.completedTraining;
    document.getElementById('metricDetectorDatasets').textContent = cards.detectorDatasetCount ?? 0;
    document.getElementById('metricVlmDatasets').textContent = cards.vlmDatasetCount ?? 0;
    document.getElementById('metricExports').textContent = cards.deployedModelCount;
    document.getElementById('metricStorageUsed').textContent = formatBytes(cards.storage.usedBytes);
    document.getElementById('metricStorageTotal').textContent = `/ ${formatBytes(cards.storage.totalBytes)}`;
    document.getElementById('metricStoragePercent').textContent = `${Number(cards.storage.percent || 0).toFixed(1)}% 사용`;
    renderJobs(summary.recentJobs || []);
    renderExports(summary.recentExports || []);
    renderDistribution(summary.distribution || {});
    renderLogSelector(summary.recentJobs || [], summary.latestLog || null);
  }

  function init() {
    document.getElementById('dashboardRefreshButton').addEventListener('click', () => load().catch(global.MLOps.handleError));
    document.getElementById('dashboardLogJobSelect').addEventListener('change', (event) => {
      selectedLogJobId = event.target.value;
      const selected = latestJobs.find((job) => job.id === selectedLogJobId);
      selectedLogJobStatus = selected?.status || '';
      openLogStream(selectedLogJobId);
    });
  }

  global.MLOps.dashboardController = { init, load };
})(window);
