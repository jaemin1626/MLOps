(function initializeModelListController(global) {
  'use strict';

  const { api } = global.MLOps;
  const {
    escapeHtml,
    badgeForStatus,
    formatDeploymentStatus,
    isDeploymentSupported,
    modelTypeBadge,
    resolveLearningRateLabel,
  } = global.MLOps.formatters;
  let models = [];
  let listLoadSequence = 0;
  let openingModelId = '';

  function weightCell(model) {
    const weight = model.representativeWeight || { name: '-', extraCount: 0 };
    if (weight.name === '-') return '-';
    const extra = weight.extraCount > 0
      ? `<span class="model-weight-extra">+${weight.extraCount}</span>`
      : '';
    return `<span class="model-weight-chip"><strong>${escapeHtml(weight.name)}</strong>${extra}</span>`;
  }

  function renderActionLinks(model) {
    const deploymentAction = !isDeploymentSupported(model)
      ? '<span class="muted">-</span>'
      : `<button type="button" data-action="deployment" data-model-id="${escapeHtml(model.id)}">${model.deploymentStatus === 'deployed' ? '배포 정보' : '배포'}</button>`;
    return `<div class="model-action-links">
      <button type="button" data-action="training" data-model-id="${escapeHtml(model.id)}">학습 정보</button>
      <span class="muted">/</span>
      ${deploymentAction}
    </div>`;
  }

  function renderRow(model) {
    const deploymentCell = isDeploymentSupported(model)
      ? `<td class="clickable-cell" data-section="deployment">${formatDeploymentStatus(model)}</td>`
      : `<td>${formatDeploymentStatus(model)}</td>`;
    return `<tr data-model-id="${escapeHtml(model.id)}">
      <td class="clickable-cell" data-section="overview">${escapeHtml(model.modelName)}</td>
      <td class="clickable-cell" data-section="overview">${modelTypeBadge(model)}</td>
      <td class="clickable-cell" data-section="training"><span class="cell-link">${escapeHtml(String(model.finalEpoch ?? '-'))}</span></td>
      <td class="clickable-cell" data-section="training"><span class="cell-link">${escapeHtml(resolveLearningRateLabel(model))}</span></td>
      <td class="clickable-cell" data-section="weights">${weightCell(model)}</td>
      <td class="clickable-cell" data-section="training">${badgeForStatus(model.status)}</td>
      ${deploymentCell}
      <td>${renderActionLinks(model)}</td>
    </tr>`;
  }

  function setSelectedRow(modelId) {
    const body = document.getElementById('modelListTableBody');
    body.querySelectorAll('tr[data-model-id]').forEach((row) => {
      row.classList.toggle('is-selected', row.dataset.modelId === modelId);
    });
  }

  function openModel(modelId, section = 'overview') {
    if (!modelId || openingModelId === modelId) {
      return;
    }
    openingModelId = modelId;
    setSelectedRow(modelId);
    global.MLOps.modelDetailController.open(modelId, section);
    window.setTimeout(() => {
      if (openingModelId === modelId) {
        openingModelId = '';
      }
    }, 400);
  }

  function bindRowEvents() {
    const body = document.getElementById('modelListTableBody');
    body.querySelectorAll('.clickable-cell').forEach((cell) => {
      cell.addEventListener('click', () => {
        const row = cell.closest('tr[data-model-id]');
        openModel(row.dataset.modelId, cell.dataset.section || 'overview');
      });
    });
    body.querySelectorAll('button[data-model-id]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const section = button.dataset.action === 'deployment' ? 'deployment' : 'training';
        openModel(button.dataset.modelId, section);
      });
    });
  }

  async function load(options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const requestId = ++listLoadSequence;
    const body = document.getElementById('modelListTableBody');

    if (!forceRefresh && models.length) {
      body.innerHTML = models.map(renderRow).join('');
      bindRowEvents();
      return models;
    }

    const result = await api.get('/api/model-management/models');
    if (requestId !== listLoadSequence) {
      return models;
    }
    models = result.models || [];
    if (!models.length) {
      body.innerHTML = '<tr><td class="empty-cell" colspan="8">모델이 없습니다. 학습을 완료하면 자동으로 표시됩니다.</td></tr>';
    } else {
      body.innerHTML = models.map(renderRow).join('');
      bindRowEvents();
    }
    return models;
  }

  function init() {
    document.getElementById('modelListRefreshButton').addEventListener('click', () => {
      global.MLOps.modelDetailController.invalidateCache();
      load({ forceRefresh: true }).catch(global.MLOps.handleError);
    });
  }

  global.MLOps.modelListController = { init, load, getModels: () => models };
})(window);
