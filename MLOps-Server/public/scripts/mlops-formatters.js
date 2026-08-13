(function initializeFormatters(global) {
  'use strict';

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    return `${(value / (1024 ** index)).toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(date).replace(/\. /g, '-').replace('.', '');
  }

  function formatElapsed(seconds) {
    const total = Math.max(0, Number(seconds || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remaining = Math.floor(total % 60);
    return [hours, minutes, remaining].map((item) => String(item).padStart(2, '0')).join(':');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function badgeForStatus(status) {
    const normalized = String(status || '').toLowerCase();
    const map = {
      running: ['진행 중', 'blue'], completed: ['완료', 'green'], failed: ['실패', 'red'],
      cancelled: ['중지됨', 'orange'],
      waiting: ['대기', 'orange'], status_unknown: ['확인 불가', 'gray'],
      model_file_missing: ['모델 파일 없음', 'red'],
    };
    const [label, color] = map[normalized] || [status || '-', 'gray'];
    return `<span class="badge ${color}">${escapeHtml(label)}</span>`;
  }

  function isDeploymentSupported(model) {
    return !(model?.trainingType === 'vlm' || model?.modelType === 'VLM');
  }

  function formatDeploymentStatus(model) {
    if (!isDeploymentSupported(model)) {
      return '-';
    }
    return badgeForDeploymentStatus(model?.deploymentStatus, model?.deploymentStatusLabel);
  }

  function badgeForDeploymentStatus(status, label) {
    if (String(status || '').toLowerCase() === 'not_applicable') {
      return '-';
    }
    const map = {
      deployed: ['배포 완료', 'green'],
      not_deployed: ['미배포', 'gray'],
      deploying: ['배포 중', 'blue'],
      failed: ['배포 실패', 'red'],
    };
    const [resolvedLabel, color] = map[String(status || '').toLowerCase()] || [label || status || '-', 'gray'];
    return `<span class="badge ${color}">${escapeHtml(resolvedLabel)}</span>`;
  }

  function modelTypeBadge(model) {
    if (model.trainingType === 'vlm' || model.modelType === 'VLM') {
      return '<span class="badge purple">VLM</span>';
    }
    return '<span class="badge green">검출기</span>';
  }

  function formatLearningRate(value) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '-';
    const number = Number(value);
    if (number >= 1) return String(number);
    return String(number).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  }

  function resolveLearningRateLabel(model) {
    if (model?.learningRateLabel && model.learningRateLabel !== '-') return model.learningRateLabel;
    if (model?.learningRate != null) return formatLearningRate(model.learningRate);
    return '-';
  }

  function formToObject(form) {
    const output = {};
    for (const element of form.elements) {
      if (!element.name || element.disabled || element.closest('.hidden')) continue;
      if (element.type === 'checkbox') {
        if (element.name === 'datasetPaths') {
          if (!output[element.name]) output[element.name] = [];
          if (element.checked) output[element.name].push(element.value);
        } else {
          output[element.name] = element.checked;
        }
      }
      else if (element.tagName === 'SELECT' && element.multiple) {
        output[element.name] = Array.from(element.selectedOptions)
          .map((option) => option.value)
          .filter(Boolean);
      }
      else if (element.type === 'number') output[element.name] = element.value === '' ? '' : Number(element.value);
      else output[element.name] = element.value;
    }
    return output;
  }

  function showToast(message, type = 'success') {
    const host = document.getElementById('toastHost');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    host.appendChild(toast);
    setTimeout(() => toast.remove(), 3600);
  }

  global.MLOps = global.MLOps || {};
  global.MLOps.formatters = {
    formatBytes,
    formatDate,
    formatElapsed,
    escapeHtml,
    badgeForStatus,
    badgeForDeploymentStatus,
    formatDeploymentStatus,
    isDeploymentSupported,
    modelTypeBadge,
    formatLearningRate,
    resolveLearningRateLabel,
    formToObject,
    showToast,
  };
})(window);
