(function initializeTrainingMonitorController(global) {
  'use strict';

  const { api } = global.MLOps;
  const { escapeHtml, badgeForStatus, formatElapsed, formatDate, showToast } = global.MLOps.formatters;
  const INITIAL_VISIBLE = 5;
  const LOAD_MORE_STEP = 5;
  let jobs = [];
  let visibleJobCount = INITIAL_VISIBLE;
  let selectedJobId = '';
  let selectedStatus = '';
  let logSource = null;
  let pollTimer = null;
  let elapsedTimer = null;

  function stripAnsi(text) {
    return String(text || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  }

  function parseTrainingProgressFromLogLine(line) {
    const cleaned = stripAnsi(line).trim();
    if (!cleaned) return null;

    const starting = cleaned.match(/Starting training for (\d+) epochs?/i);
    if (starting) {
      return { totalEpoch: Number(starting[1]) };
    }

    const epochMatch = cleaned.match(/^(\d+)\/(\d+)\s+\S+\s+([\d.]+)/);
    if (!epochMatch) return null;

    const epoch = Number(epochMatch[1]);
    const totalEpoch = Number(epochMatch[2]);
    const loss = Number(epochMatch[3]);
    let step = 0;
    let totalStep = 0;
    const batchMatch = cleaned.match(/:\s*\d+%[^0-9/]*(\d+)\/(\d+)\s+\d/);
    if (batchMatch) {
      step = Number(batchMatch[1]);
      totalStep = Number(batchMatch[2]);
    }

    const progress = totalStep > 0
      ? Math.min(100, Math.round(((epoch - 1 + (step / totalStep)) / Math.max(totalEpoch, 1)) * 10000) / 100)
      : Math.min(100, Math.round((epoch / Math.max(totalEpoch, 1)) * 10000) / 100);

    return { epoch, totalEpoch, step, totalStep, loss, progress };
  }

  function computeElapsedSeconds(job) {
    if (!job) return 0;
    if (job.status === 'running' && job.startedAt) {
      return Math.max(0, Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000));
    }
    if (Number.isFinite(Number(job.elapsedSeconds))) {
      return Number(job.elapsedSeconds);
    }
    if (!job.startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000));
  }

  function progressCell(job) {
    const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
    return `<div class="progress-cell"><span>${progress.toFixed(0)}%</span><div class="progress"><div class="progress-bar" style="width:${progress}%"></div></div></div>`;
  }

  function ensureSelectedJobVisible() {
    if (!selectedJobId) return;
    const index = jobs.findIndex((job) => job.id === selectedJobId);
    if (index < 0) return;
    if (index >= visibleJobCount) {
      visibleJobCount = Math.min(jobs.length, Math.ceil((index + 1) / LOAD_MORE_STEP) * LOAD_MORE_STEP);
    }
  }

  function updateJobTableFooterButtons() {
    const loadMoreButton = document.getElementById('trainingJobLoadMoreButton');
    const collapseButton = document.getElementById('trainingJobCollapseButton');
    if (!loadMoreButton || !collapseButton) return;
    const remaining = Math.max(0, jobs.length - visibleJobCount);
    loadMoreButton.classList.toggle('hidden', remaining === 0);
    collapseButton.classList.toggle('hidden', visibleJobCount <= INITIAL_VISIBLE);
    if (remaining > 0) {
      loadMoreButton.textContent = `더보기 (${Math.min(LOAD_MORE_STEP, remaining)}개)`;
    }
    collapseButton.textContent = `접기 (${visibleJobCount - INITIAL_VISIBLE}개)`;
  }

  function renderTable() {
    const body = document.getElementById('trainingJobTableBody');
    if (!jobs.length) {
      body.innerHTML = '<tr><td class="empty-cell" colspan="9">학습 작업이 없습니다.</td></tr>';
      updateJobTableFooterButtons();
      return;
    }
    const visibleJobs = jobs.slice(0, visibleJobCount);
    body.innerHTML = visibleJobs.map((job) => `<tr data-job-id="${escapeHtml(job.id)}" class="${job.id === selectedJobId ? 'selected' : ''}">
      <td>${escapeHtml(job.name)}</td><td>${job.trainingType === 'vlm' ? '<span class="badge purple">VLM</span>' : '<span class="badge green">검출기</span>'}</td>
      <td><span class="path-text" title="${escapeHtml(job.datasetPath)}">${escapeHtml(job.datasetPath)}</span></td>
      <td>${formatDate(job.startedAt)}</td>
      <td>${job.epoch ?? 0} / ${job.totalEpoch ?? '-'}</td><td>${job.step ?? 0} / ${job.totalStep ?? '-'}</td>
      <td>${job.loss ?? '-'}</td><td>${progressCell(job)}</td><td>${badgeForStatus(job.status)}</td>
    </tr>`).join('');
    body.querySelectorAll('tr[data-job-id]').forEach((row) => row.addEventListener('click', () => selectJob(row.dataset.jobId)));
    updateJobTableFooterButtons();
  }

  function renderSelect() {
    const select = document.getElementById('trainingJobSelect');
    select.innerHTML = '<option value="">학습 작업을 선택하세요.</option>' + jobs.map((job) => `<option value="${escapeHtml(job.id)}">${escapeHtml(job.name)} · ${escapeHtml(job.status)}</option>`).join('');
    select.value = selectedJobId;
  }

  function updateStopButton(job) {
    const button = document.getElementById('trainingJobStopButton');
    if (!button) return;
    const canStop = Boolean(job && job.status === 'running');
    button.disabled = !canStop;
  }

  function updateSummary(job) {
    document.getElementById('monitorStatus').innerHTML = job ? badgeForStatus(job.status) : '-';
    document.getElementById('monitorEpoch').textContent = job ? `${job.epoch ?? 0} / ${job.totalEpoch ?? '-'}` : '-';
    document.getElementById('monitorStep').textContent = job ? `${job.step ?? 0} / ${job.totalStep ?? '-'}` : '-';
    document.getElementById('monitorLoss').textContent = job?.loss ?? '-';
    document.getElementById('monitorElapsed').textContent = job ? formatElapsed(computeElapsedSeconds(job)) : '-';
    const progress = job ? Math.max(0, Math.min(100, Number(job.progress || 0))) : 0;
    document.getElementById('monitorProgressText').textContent = job ? `${progress.toFixed(1)}%` : '-';
    document.getElementById('monitorProgressBar').style.width = `${progress}%`;
    updateStopButton(job);
  }

  function applyProgressToJob(jobId, parsed) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || !parsed) return null;
    Object.assign(job, parsed);
    if (job.startedAt) {
      job.elapsedSeconds = computeElapsedSeconds(job);
    }
    if (jobId === selectedJobId) {
      updateSummary(job);
      renderTable();
    }
    return job;
  }

  function syncElapsedTimer() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = setInterval(() => {
      const job = jobs.find((item) => item.id === selectedJobId);
      if (!job || job.status !== 'running') return;
      job.elapsedSeconds = computeElapsedSeconds(job);
      document.getElementById('monitorElapsed').textContent = formatElapsed(job.elapsedSeconds);
    }, 1000);
  }

  function openLogStream(jobId, reset = true) {
    if (logSource) logSource.close();
    const consoleElement = document.getElementById('trainingLiveLog');
    if (reset) consoleElement.textContent = '';
    if (!jobId) {
      consoleElement.textContent = '학습 작업을 선택하세요.';
      return;
    }
    logSource = api.openEventStream(`/api/training/jobs/${encodeURIComponent(jobId)}/log-stream`, {
      onLog: ({ text }) => {
        consoleElement.textContent += text;
        consoleElement.scrollTop = consoleElement.scrollHeight;
        const parsed = parseTrainingProgressFromLogLine(text);
        if (parsed) applyProgressToJob(jobId, parsed);
      },
    });
  }

  function selectJob(jobId) {
    selectedJobId = jobId;
    const job = jobs.find((item) => item.id === jobId);
    selectedStatus = job?.status || '';
    document.getElementById('trainingJobSelect').value = jobId;
    ensureSelectedJobVisible();
    updateSummary(job);
    renderTable();
    openLogStream(jobId, true);
    syncElapsedTimer();
  }

  async function stopSelectedJob() {
    if (!selectedJobId) return;
    const job = jobs.find((item) => item.id === selectedJobId);
    if (!job || job.status !== 'running') return;
    if (!window.confirm(`"${job.name}" 학습을 중지할까요?`)) return;

    const button = document.getElementById('trainingJobStopButton');
    if (button) button.disabled = true;
    try {
      await api.post(`/api/training/jobs/${encodeURIComponent(selectedJobId)}/stop`, {});
      showToast('학습 중지를 요청했습니다.', 'success');
      await loadJobs(selectedJobId);
    } catch (error) {
      if (button) button.disabled = false;
      throw error;
    }
  }

  async function loadJobs(preferredJobId = '') {
    const result = await api.get('/api/training/jobs');
    jobs = result.jobs || [];
    if (preferredJobId) selectedJobId = preferredJobId;
    if (!selectedJobId && jobs.length) selectedJobId = jobs[0].id;
    if (selectedJobId && !jobs.some((job) => job.id === selectedJobId)) selectedJobId = jobs[0]?.id || '';
    ensureSelectedJobVisible();
    renderTable();
    renderSelect();
    const selected = jobs.find((job) => job.id === selectedJobId);
    updateSummary(selected);
    syncElapsedTimer();
    if (selected && selected.status !== selectedStatus) {
      selectedStatus = selected.status;
      openLogStream(selectedJobId, true);
    } else if (selected && !logSource) {
      openLogStream(selectedJobId, true);
    }
  }

  function init() {
    document.getElementById('trainingJobSelect').addEventListener('change', (event) => selectJob(event.target.value));
    document.getElementById('trainingMonitorRefreshButton').addEventListener('click', () => {
      visibleJobCount = INITIAL_VISIBLE;
      loadJobs().catch(global.MLOps.handleError);
    });
    document.getElementById('trainingJobStopButton').addEventListener('click', () => {
      stopSelectedJob().catch(global.MLOps.handleError);
    });
    document.getElementById('trainingJobLoadMoreButton').addEventListener('click', () => {
      visibleJobCount = Math.min(jobs.length, visibleJobCount + LOAD_MORE_STEP);
      renderTable();
    });
    document.getElementById('trainingJobCollapseButton').addEventListener('click', () => {
      visibleJobCount = INITIAL_VISIBLE;
      renderTable();
    });
    pollTimer = setInterval(() => {
      if (document.getElementById('training-monitor-page').classList.contains('active') || document.getElementById('dashboard-page').classList.contains('active')) {
        loadJobs().catch(() => {});
      }
    }, 1600);
  }

  global.MLOps.trainingMonitorController = { init, loadJobs, selectJob };
})(window);