(function initializeModelDetailController(global) {
  'use strict';

  const { api } = global.MLOps;
  const {
    escapeHtml,
    formatDate,
    badgeForStatus,
    formatDeploymentStatus,
    isDeploymentSupported,
    modelTypeBadge,
    resolveLearningRateLabel,
  } = global.MLOps.formatters;
  let currentModelId = '';
  let currentSection = 'overview';
  let currentModel = null;
  let loadSequence = 0;
  const modelCache = new Map();

  function deploymentPanelElement() {
    return document.querySelector('.model-detail-deployment-panel');
  }

  function updateDeploymentPanelVisibility(model) {
    const panel = deploymentPanelElement();
    if (!panel) return;
    panel.classList.toggle('hidden', !isDeploymentSupported(model));
  }

  function showLoadingState(modelId) {
    document.getElementById('modelDetailTitle').textContent = '모델 정보 불러오는 중...';
    document.getElementById('modelDetailBadges').innerHTML = '<span class="badge gray">loading</span>';
    document.getElementById('modelDetailSummary').innerHTML = '<div class="muted">선택한 모델 데이터를 불러오는 중입니다.</div>';
    document.getElementById('modelDetailTraining').innerHTML = '<div class="muted">불러오는 중...</div>';
    document.getElementById('modelDetailWeights').innerHTML = '<div class="muted">불러오는 중...</div>';
    document.getElementById('modelDetailDeployment').innerHTML = '<div class="muted">불러오는 중...</div>';
    updateDeploymentPanelVisibility({ modelType: '검출기' });
    document.getElementById('model-detail-page')?.classList.add('is-loading');
    document.getElementById('model-detail-page')?.setAttribute('data-loading-model-id', modelId);
  }

  function clearLoadingState() {
    document.getElementById('model-detail-page')?.classList.remove('is-loading');
    document.getElementById('model-detail-page')?.removeAttribute('data-loading-model-id');
  }

  function renderSummaryStats(model) {
    const stats = [
      ['Epoch', escapeHtml(String(model.finalEpoch ?? '-'))],
      ['Learning Rate', escapeHtml(resolveLearningRateLabel(model))],
      ['대표 가중치', escapeHtml(model.representativeWeight?.name || '-')],
    ];
    if (isDeploymentSupported(model)) {
      stats.push(['배포 상태', escapeHtml(model.deploymentStatusLabel || '-')]);
    }
    return stats.map(([label, value]) => (
      `<div class="detail-stat"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`
    )).join('');
  }

  function definitionList(items) {
    return `<dl class="detail-definition-list">${items.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  }

  function renderSummary(model) {
    updateDeploymentPanelVisibility(model);
    document.getElementById('modelDetailTitle').textContent = model.modelName;
    const deploymentBadge = isDeploymentSupported(model) ? ` ${formatDeploymentStatus(model)}` : '';
    document.getElementById('modelDetailBadges').innerHTML = `${modelTypeBadge(model)} ${badgeForStatus(model.status)}${deploymentBadge}`;
    document.getElementById('modelDetailSummary').innerHTML = renderSummaryStats(model);
  }

  function renderTraining(model) {
    document.getElementById('modelDetailTraining').innerHTML = definitionList([
      ['모델명', escapeHtml(model.modelName)],
      ['모델 유형', model.modelType === 'VLM' ? 'VLM' : '검출기'],
      ['학습 Job ID', escapeHtml(model.sourceJobId || '-')],
      ['데이터셋', `<span class="path-text" title="${escapeHtml(model.datasetPath)}">${escapeHtml(model.datasetPath)}</span>`],
      ['Epoch', escapeHtml(String(model.finalEpoch ?? '-'))],
      ['Learning Rate', escapeHtml(resolveLearningRateLabel(model))],
      ['Step', escapeHtml(String(model.finalStep ?? '-'))],
      ['Loss', escapeHtml(String(model.finalLoss ?? '-'))],
      ['학습 상태', badgeForStatus(model.status)],
      ['완료 일시', escapeHtml(formatDate(model.completedAt))],
    ]);
  }

  function renderWeights(model) {
    const files = model.weightFiles || [];
    if (!files.length) {
      document.getElementById('modelDetailWeights').innerHTML = '<div class="muted">등록된 가중치 정보가 없습니다.</div>';
      return;
    }
    document.getElementById('modelDetailWeights').innerHTML = `<div class="table-wrap model-detail-table-wrap"><table class="data-table model-detail-table"><thead><tr><th>파일명</th><th>경로</th><th>출처</th></tr></thead><tbody>${
      files.map((file) => `<tr><td><strong>${escapeHtml(file.name)}</strong></td><td><span class="path-text path-text-full" title="${escapeHtml(file.path)}">${escapeHtml(file.path || '-')}</span></td><td>${escapeHtml(file.source || '-')}</td></tr>`).join('')
    }</tbody></table></div>`;
  }

  function renderDeployment(model) {
    if (!isDeploymentSupported(model)) {
      document.getElementById('modelDetailDeployment').innerHTML = '';
      return;
    }
    const exports = model.exports || [];
    const latest = model.latestExport;
    const summary = definitionList([
      ['배포 상태', formatDeploymentStatus(model)],
      ['최근 ONNX', escapeHtml(latest?.outputOnnxFileName || '-')],
      ['최근 배포 일시', escapeHtml(formatDate(latest?.completedAt || latest?.startedAt))],
    ]);
    const history = exports.length
      ? `<div class="table-wrap model-detail-table-wrap" style="margin-top:16px"><table class="data-table model-detail-table"><thead><tr><th>Export ID</th><th>원본 .pt</th><th>출력 .onnx</th><th>일시</th><th>상태</th><th>작업</th></tr></thead><tbody>${
        exports.map((item) => {
          const downloadCell = item.status === 'completed'
            ? `<a class="button small" href="/api/model-management/exports/${encodeURIComponent(item.id)}/download" download="${escapeHtml(item.outputOnnxFileName || 'model.onnx')}">다운로드</a>`
            : '<span class="muted">-</span>';
          return `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.sourcePtFileName || '-')}</td><td>${escapeHtml(item.outputOnnxFileName || '-')}</td><td>${formatDate(item.completedAt || item.startedAt)}</td><td>${badgeForStatus(item.status)}</td><td>${downloadCell}</td></tr>`;
        }).join('')
      }</tbody></table></div>`
      : '<div class="muted" style="margin-top:16px">배포 이력이 없습니다.</div>';
    document.getElementById('modelDetailDeployment').innerHTML = `${summary}${history}<div class="action-bar"><button type="button" class="button primary" id="modelDetailGoExportButton">모델 배포 페이지로 이동</button></div>`;
    document.getElementById('modelDetailGoExportButton').addEventListener('click', () => {
      global.MLOps.navigateTo('model-export-page');
    });
  }

  function renderModel(model, section = currentSection) {
    currentModel = model;
    renderSummary(model);
    renderTraining(model);
    renderWeights(model);
    renderDeployment(model);
    focusSection(section, model);
  }

  function focusSection(section, model = currentModel) {
    const targetMap = {
      overview: document.getElementById('modelDetailSummary'),
      training: document.getElementById('modelDetailTraining'),
      weights: document.getElementById('modelDetailWeights'),
      deployment: document.getElementById('modelDetailDeployment'),
    };
    const resolvedSection = section === 'deployment' && model && !isDeploymentSupported(model)
      ? 'training'
      : section;
    const target = targetMap[resolvedSection] || targetMap.overview;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function load(modelId, options = {}) {
    const section = options.section || currentSection;
    const forceRefresh = options.forceRefresh === true;
    const requestId = ++loadSequence;

    currentModelId = modelId;
    currentSection = section;

    if (!forceRefresh && modelCache.has(modelId)) {
      if (requestId !== loadSequence) {
        return null;
      }
      clearLoadingState();
      renderModel(modelCache.get(modelId), section);
      return modelCache.get(modelId);
    }

    showLoadingState(modelId);

    try {
      const result = await api.get(`/api/model-management/models/${encodeURIComponent(modelId)}`);
      if (requestId !== loadSequence || currentModelId !== modelId) {
        return null;
      }
      const model = result.model;
      modelCache.set(modelId, model);
      clearLoadingState();
      renderModel(model, section);
      return model;
    } catch (error) {
      if (requestId !== loadSequence) {
        return null;
      }
      clearLoadingState();
      throw error;
    }
  }

  function open(modelId, section = 'overview') {
    currentModelId = modelId;
    currentSection = section;
    window.location.hash = `model-detail-page?model=${encodeURIComponent(modelId)}&section=${encodeURIComponent(section)}`;
    global.MLOps.navigateTo('model-detail-page');
  }

  function init() {
    document.getElementById('modelDetailBackButton').addEventListener('click', () => {
      global.MLOps.navigateTo('model-list-page');
    });
  }

  function modelMatchesId(model, modelId) {
    if (!model || !modelId) return false;
    return model.id === modelId
      || model.folderName === modelId
      || model.sourceJobId === modelId;
  }

  function restoreFromHash() {
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith('model-detail-page')) return;
    const query = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(query);
    const modelId = params.get('model');
    const section = params.get('section') || 'overview';
    if (!modelId) return;

    if (modelMatchesId(currentModel, modelId) && section === currentSection) {
      currentModelId = modelId;
      return;
    }
    if (modelMatchesId(currentModel, modelId)) {
      currentModelId = modelId;
      currentSection = section;
      focusSection(section, currentModel);
      return;
    }

    load(modelId, { section }).catch(global.MLOps.handleError);
  }

  function invalidateCache(modelId = '') {
    if (modelId) {
      modelCache.delete(modelId);
      return;
    }
    modelCache.clear();
  }

  global.MLOps.modelDetailController = {
    init,
    open,
    load,
    restoreFromHash,
    invalidateCache,
  };
})(window);
