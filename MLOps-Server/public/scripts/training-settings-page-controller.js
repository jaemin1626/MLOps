(function initializeTrainingSettingsController(global) {
  'use strict';

  const { api } = global.MLOps;
  const { formToObject, showToast, escapeHtml } = global.MLOps.formatters;

  let selectedModelPath = '';
  let datasetOptions = [];
  let vlmDatasetOptions = [];
  let detectorWizardStep = 1;
  let detectorWizardMaxStep = 1;
  let vlmWizardStep = 1;
  let vlmWizardMaxStep = 1;
  let datasetSuggestionsCache = null;
  let vlmDatasetSuggestionsCache = null;
  const DATASET_SUGGESTIONS_CACHE_TTL_MS = 60000;
  const DETECTOR_SUGGESTIONS_SESSION_KEY = 'mlops.detectorDatasetSuggestions';
  const VLM_SUGGESTIONS_SESSION_KEY = 'mlops.vlmDatasetSuggestions';

  function getDatasetSuggestionsQuery(refresh = false) {
    return refresh ? '?refresh=1' : '';
  }

  function readSessionSuggestionsCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.value || Date.now() - parsed.at > DATASET_SUGGESTIONS_CACHE_TTL_MS) {
        sessionStorage.removeItem(key);
        return null;
      }
      return parsed.value;
    } catch (_error) {
      return null;
    }
  }

  function writeSessionSuggestionsCache(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
    } catch (_error) {
      // ignore quota / private mode errors
    }
  }

  async function fetchDetectorDatasetSuggestions(refresh = false) {
    const query = getDatasetSuggestionsQuery(refresh);
    if (!refresh && datasetSuggestionsCache) {
      return datasetSuggestionsCache;
    }
    if (!refresh) {
      const cached = readSessionSuggestionsCache(DETECTOR_SUGGESTIONS_SESSION_KEY);
      if (cached) {
        datasetSuggestionsCache = cached;
        return cached;
      }
    }
    const result = await api.get(`/api/training/dataset-suggestions${query}`);
    datasetSuggestionsCache = result;
    writeSessionSuggestionsCache(DETECTOR_SUGGESTIONS_SESSION_KEY, result);
    return result;
  }

  async function fetchVlmDatasetSuggestions(refresh = false) {
    const query = getDatasetSuggestionsQuery(refresh);
    if (!refresh && vlmDatasetSuggestionsCache) {
      return vlmDatasetSuggestionsCache;
    }
    if (!refresh) {
      const cached = readSessionSuggestionsCache(VLM_SUGGESTIONS_SESSION_KEY);
      if (cached) {
        vlmDatasetSuggestionsCache = cached;
        return cached;
      }
    }
    const result = await api.get(`/api/training/vlm-dataset-suggestions${query}`);
    vlmDatasetSuggestionsCache = result;
    writeSessionSuggestionsCache(VLM_SUGGESTIONS_SESSION_KEY, result);
    return result;
  }

  function getCheckedDatasetPaths(pickerElement) {
    if (!pickerElement) return [];
    return Array.from(pickerElement.querySelectorAll('input[type="checkbox"][name="datasetPaths"]:checked'))
      .map((input) => input.value)
      .filter(Boolean);
  }

  function getDatasetPickerFromForm(form) {
    if (form?.id === 'trainingVlmForm') {
      return document.getElementById('trainingVlmDatasetPathPicker');
    }
    return document.getElementById('trainingDatasetPathPicker');
  }

  function normalizeTrainingDatasetParams(params) {
    let paths = params.datasetPaths;
    if (!Array.isArray(paths)) {
      paths = params.datasetPath
        ? String(params.datasetPath).split(',').map((item) => item.trim()).filter(Boolean)
        : [];
    }
    paths = paths.filter(Boolean);
    return { ...params, datasetPaths: paths, datasetPath: paths.join(',') };
  }

  function validateCommonTrainingSettings(form) {
    const name = form.querySelector('[name="name"]')?.value?.trim();
    const datasetPaths = getCheckedDatasetPaths(getDatasetPickerFromForm(form));
    const outputPath = form.querySelector('[name="outputPath"]')?.value?.trim();
    const epochs = Number(form.querySelector('[name="epochs"]')?.value);
    const batchSize = Number(form.querySelector('[name="batchSize"]')?.value);
    const learningRate = Number(form.querySelector('[name="learningRate"]')?.value);

    if (!name) return { ok: false, message: '학습명을 입력하세요.' };
    if (!datasetPaths.length) return { ok: false, message: '학습 데이터셋을 하나 이상 선택하세요.' };
    if (!outputPath) return { ok: false, message: '학습 결과 저장 경로를 입력하세요.' };
    if (!epochs || epochs < 1) return { ok: false, message: 'Epoch는 1 이상이어야 합니다.' };
    if (!batchSize || batchSize < 1) return { ok: false, message: 'Batch Size는 1 이상이어야 합니다.' };
    if (!Number.isFinite(learningRate) || learningRate <= 0) {
      return { ok: false, message: 'Learning Rate를 확인하세요.' };
    }
    return { ok: true };
  }

  function validateDetectorCommonTrainingSettings() {
    return validateCommonTrainingSettings(getDetectorForm());
  }

  function validateVlmCommonTrainingSettings() {
    return validateCommonTrainingSettings(getVlmForm());
  }

  function updateDetectorStepNav(step) {
    document.querySelectorAll('#trainingDetectorStepNav .training-step').forEach((button) => {
      const stepNumber = Number(button.dataset.step);
      button.classList.toggle('is-active', stepNumber === step);
      button.classList.toggle('is-complete', stepNumber < step);
      if (stepNumber === 1) {
        button.disabled = false;
      } else {
        button.disabled = stepNumber > detectorWizardMaxStep;
      }
    });
  }

  function setDetectorWizardStep(step, options = {}) {
    const nextStep = step === 2 ? 2 : 1;
    if (nextStep === 2 && !options.skipValidation) {
      const validation = validateDetectorCommonTrainingSettings();
      if (!validation.ok) {
        showToast(validation.message);
        return false;
      }
    }

    detectorWizardStep = nextStep;
    detectorWizardMaxStep = Math.max(detectorWizardMaxStep, nextStep);
    document.getElementById('trainingDetectorCommonStep')?.classList.toggle('is-step-hidden', nextStep !== 1);
    document.getElementById('detectorFields')?.classList.toggle('is-step-hidden', nextStep !== 2);
    document.getElementById('trainingCommandPanelContent')?.classList.toggle('is-step-hidden', nextStep !== 2);
    document.getElementById('trainingCommandPanelStep1Hint')?.classList.toggle('is-step-hidden', nextStep !== 1);
    updateDetectorStepNav(nextStep);

    if (nextStep === 2) {
      refreshSplitPathSuggestions().catch(global.MLOps.handleError);
      loadSuggestedClassDefinitionText(getPrimaryDatasetPath()).catch(() => {});
    }
    return true;
  }

  function wireDetectorWizard() {
    document.getElementById('trainingDetectorNextStepButton')?.addEventListener('click', () => {
      setDetectorWizardStep(2);
    });
    document.getElementById('trainingDetectorPrevStepButton')?.addEventListener('click', () => {
      setDetectorWizardStep(1, { skipValidation: true });
    });
    document.querySelectorAll('#trainingDetectorStepNav .training-step').forEach((button) => {
      button.addEventListener('click', () => {
        const stepNumber = Number(button.dataset.step);
        if (Number.isNaN(stepNumber) || button.disabled) return;
        setDetectorWizardStep(stepNumber, { skipValidation: stepNumber === 1 });
      });
    });
  }

  function resetDetectorWizard() {
    detectorWizardMaxStep = 1;
    setDetectorWizardStep(1, { skipValidation: true });
  }

  function updateVlmStepNav(step) {
    document.querySelectorAll('#trainingVlmStepNav .training-step').forEach((button) => {
      const stepNumber = Number(button.dataset.step);
      button.classList.toggle('is-active', stepNumber === step);
      button.classList.toggle('is-complete', stepNumber < step);
      if (stepNumber === 1) {
        button.disabled = false;
      } else {
        button.disabled = stepNumber > vlmWizardMaxStep;
      }
    });
  }

  function setVlmWizardStep(step, options = {}) {
    const nextStep = step === 2 ? 2 : 1;
    if (nextStep === 2 && !options.skipValidation) {
      const validation = validateVlmCommonTrainingSettings();
      if (!validation.ok) {
        showToast(validation.message);
        return false;
      }
    }

    vlmWizardStep = nextStep;
    vlmWizardMaxStep = Math.max(vlmWizardMaxStep, nextStep);
    document.getElementById('trainingVlmCommonStep')?.classList.toggle('is-step-hidden', nextStep !== 1);
    document.getElementById('vlmFields')?.classList.toggle('is-step-hidden', nextStep !== 2);
    document.getElementById('trainingVlmCommandPanelContent')?.classList.toggle('is-step-hidden', nextStep !== 2);
    document.getElementById('trainingVlmCommandPanelStep1Hint')?.classList.toggle('is-step-hidden', nextStep !== 1);
    updateVlmStepNav(nextStep);
    return true;
  }

  function wireVlmWizard() {
    document.getElementById('trainingVlmNextStepButton')?.addEventListener('click', () => {
      setVlmWizardStep(2);
    });
    document.getElementById('trainingVlmPrevStepButton')?.addEventListener('click', () => {
      setVlmWizardStep(1, { skipValidation: true });
    });
    document.querySelectorAll('#trainingVlmStepNav .training-step').forEach((button) => {
      button.addEventListener('click', () => {
        const stepNumber = Number(button.dataset.step);
        if (Number.isNaN(stepNumber) || button.disabled) return;
        setVlmWizardStep(stepNumber, { skipValidation: stepNumber === 1 });
      });
    });
  }

  function resetVlmWizard() {
    vlmWizardMaxStep = 1;
    setVlmWizardStep(1, { skipValidation: true });
  }

  function getDetectorForm() {
    return document.getElementById('trainingDetectorForm');
  }

  function getVlmForm() {
    return document.getElementById('trainingVlmForm');
  }

  function joinRelativePath(root, fileName) {
    return `${String(root || '').replace(/\/$/, '')}/${fileName}`.replace(/^\/+/, '');
  }

  function setOutputPathHint(workspaceRoot) {
    const hint = document.getElementById('trainingOutputPathHint');
    if (!hint) return;
    hint.textContent = workspaceRoot
      ? `학습 결과 저장 위치 · workspace: ${workspaceRoot}`
      : '학습 결과가 저장될 workspace 경로입니다.';
  }

  function getTrainingModelName() {
    return document.querySelector('#trainingDetectorForm [name="name"]')?.value?.trim() || '';
  }

  function getSplitLogPanel() {
    return document.getElementById('trainingSplitLog');
  }

  function getSplitStatusBadge() {
    return document.getElementById('trainingSplitStatus');
  }

  function setSplitStatus(status, label) {
    const badge = getSplitStatusBadge();
    if (!badge) return;
    badge.textContent = label;
    badge.className = 'badge';
    if (status === 'running') badge.classList.add('orange');
    if (status === 'completed') badge.classList.add('green');
    if (status === 'failed') badge.classList.add('red');
  }

  function renderSplitLog(lines, reset = false) {
    const panel = getSplitLogPanel();
    if (!panel) return;
    const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
    panel.textContent = reset ? text : `${panel.textContent.replace(/\s*$/, '')}\n${text}`.trim();
    panel.scrollTop = panel.scrollHeight;
  }

  function appendSplitLog(line) {
    renderSplitLog(line, false);
  }

  function applySplitPaths(trainPath, valPath, summary = '') {
    const trainInput = document.getElementById('trainingTrainPath');
    const valInput = document.getElementById('trainingValPath');
    if (trainInput) trainInput.value = trainPath || '.';
    if (valInput) valInput.value = valPath || trainPath || '.';
    const splitHint = document.getElementById('trainingSplitPathHint');
    if (splitHint && summary) {
      splitHint.textContent = summary;
    }
  }

  function getDatasetFolderLabel(datasetPath) {
    return String(datasetPath || '')
      .replace(/^dataset\/Images\//, 'Images/')
      .replace(/^dataset\//, '')
      || datasetPath
      || '(미선택)';
  }

  function findDatasetOption(datasetPath) {
    return datasetOptions.find((item) => item.datasetPath === datasetPath) || null;
  }

  function updateDatasetFolderPickerPanel(pickerElement, panelElement, findOption) {
    renderMultiDatasetInfoPanel(panelElement, getCheckedDatasetPaths(pickerElement), findOption);
  }

  function buildAppliedLabelChipsHtml(ids) {
    if (!Array.isArray(ids) || !ids.length) {
      return '<span class="label-chip is-empty">없음</span>';
    }
    return ids.map((id) => `<span class="label-chip">${escapeHtml(String(id))}</span>`).join('');
  }

  function buildAppliedLabelBreakdownHtml(options, datasetPaths) {
    if (!datasetPaths.length) return '';

    const rows = datasetPaths.map((datasetPath) => {
      const option = options.find((item) => item.datasetPath === datasetPath);
      const ids = option && Array.isArray(option.appliedLabelIds) ? option.appliedLabelIds : [];
      return `
        <li class="dataset-label-breakdown__row">
          <span class="dataset-label-breakdown__folder monospace" title="${escapeHtml(datasetPath)}">${escapeHtml(getDatasetFolderLabel(datasetPath))}</span>
          <span class="dataset-label-chips">${buildAppliedLabelChipsHtml(ids)}</span>
        </li>
      `;
    }).join('');

    return `
      <div class="dataset-label-breakdown">
        <div class="dataset-label-breakdown__title">적용 라벨</div>
        <ul class="dataset-label-breakdown__list">${rows}</ul>
      </div>
    `;
  }

  function renderMultiDatasetInfoPanel(panelElement, datasetPaths, findOption) {
    if (!panelElement) return;
    if (!datasetPaths.length) {
      panelElement.innerHTML = '<p class="muted">dataset 하위 폴더를 선택하면 정보가 표시됩니다.</p>';
      return;
    }

    const options = datasetPaths.map((item) => findOption(item)).filter(Boolean);
    const totals = options.reduce((acc, option) => ({
      imageCount: acc.imageCount + (option.imageCount ?? 0),
      labelCount: acc.labelCount + (option.labelCount ?? 0),
    }), { imageCount: 0, labelCount: 0 });

    const warnings = [];
    if (!totals.imageCount) warnings.push('이미지 없음');
    if (!totals.labelCount) warnings.push('라벨 없음');
    if (!options.some((option) => Array.isArray(option.appliedLabelIds) && option.appliedLabelIds.length)) {
      warnings.push('적용 라벨 없음');
    }

    panelElement.innerHTML = `
      <div class="dataset-info-grid dataset-info-grid--summary">
        <div class="dataset-info-item"><span>선택</span><strong>${datasetPaths.length}개</strong></div>
        <div class="dataset-info-item"><span>이미지</span><strong>${totals.imageCount}</strong></div>
        <div class="dataset-info-item"><span>라벨</span><strong>${totals.labelCount}</strong></div>
      </div>
      ${buildAppliedLabelBreakdownHtml(options, datasetPaths)}
      ${warnings.length ? `<p class="dataset-info-meta error-text">${warnings.join(' · ')}</p>` : ''}
    `;
  }

  function formatAppliedLabelIdsLabel(option) {
    const ids = Array.isArray(option?.appliedLabelIds) ? option.appliedLabelIds : [];
    if (!ids.length) return '라벨 없음';
    return `라벨 ${ids.join(', ')}`;
  }

  function buildDatasetFolderOption(option, preferredSet) {
    const label = document.createElement('label');
    label.className = 'dataset-folder-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'datasetPaths';
    input.value = option.datasetPath;
    input.checked = preferredSet.has(option.datasetPath);

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'dataset-folder-option__label monospace';
    title.textContent = getDatasetFolderLabel(option.datasetPath);
    const meta = document.createElement('span');
    meta.className = 'dataset-folder-option__meta';
    meta.textContent = `이미지 ${option.imageCount ?? 0} · 라벨 ${option.labelCount ?? 0} · ${formatAppliedLabelIdsLabel(option)}`;
    text.appendChild(title);
    text.appendChild(meta);

    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  function populateDatasetFolderPicker(pickerElement, panelElement, options, preferredPaths = []) {
    if (!pickerElement) return;
    const previousSelected = new Set(getCheckedDatasetPaths(pickerElement));
    const preferredSet = new Set([
      ...(Array.isArray(preferredPaths) ? preferredPaths : [preferredPaths].filter(Boolean)),
      ...previousSelected,
    ]);
    pickerElement.innerHTML = '';

    if (!options.length) {
      pickerElement.innerHTML = '<p class="muted">dataset 하위 폴더가 없습니다.</p>';
      updateDatasetFolderPickerPanel(pickerElement, panelElement, findDatasetOption);
      return;
    }

    options.forEach((option) => {
      pickerElement.appendChild(buildDatasetFolderOption(option, preferredSet));
    });

    if (!getCheckedDatasetPaths(pickerElement).length) {
      const fallback = options.find((item) => item.hasClasses && item.imageCount > 0) || options[0];
      if (fallback) {
        const fallbackInput = pickerElement.querySelector(`input[value="${CSS.escape(fallback.datasetPath)}"]`);
        if (fallbackInput) fallbackInput.checked = true;
      }
    }
    updateDatasetFolderPickerPanel(pickerElement, panelElement, findDatasetOption);
  }

  function findVlmDatasetOption(datasetPath) {
    return vlmDatasetOptions.find((item) => item.datasetPath === datasetPath) || null;
  }

  function renderMultiVlmDatasetInfoPanel(panelElement, datasetPaths) {
    if (!panelElement) return;
    if (!datasetPaths.length) {
      panelElement.innerHTML = '<p class="muted">VLM 주제 폴더를 선택하면 Images · label 정보가 표시됩니다.</p>';
      return;
    }

    const options = datasetPaths.map(findVlmDatasetOption).filter(Boolean);
    const totalRecords = options.reduce((sum, option) => sum + (option.recordCount ?? 0), 0);
    panelElement.innerHTML = `
      <div class="dataset-info-grid">
        <div class="dataset-info-item"><span>선택</span><strong>${datasetPaths.length}개</strong></div>
        <div class="dataset-info-item"><span>레코드</span><strong>${totalRecords}</strong></div>
        <div class="dataset-info-item"><span>주제</span><strong>${options.map((option) => option.name).join(', ') || '-'}</strong></div>
        <div class="dataset-info-item"><span>경로</span><strong class="monospace">${datasetPaths.length}개</strong></div>
      </div>
      <p class="dataset-info-meta monospace">${datasetPaths.join(' · ')}</p>
    `;
  }

  function buildVlmDatasetFolderOption(option, preferredSet) {
    const label = document.createElement('label');
    label.className = 'dataset-folder-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'datasetPaths';
    input.value = option.datasetPath;
    input.checked = preferredSet.has(option.datasetPath);

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'dataset-folder-option__label';
    title.textContent = option.name;
    const meta = document.createElement('span');
    meta.className = 'dataset-folder-option__meta monospace';
    meta.textContent = `${option.datasetPath} · label ${option.recordCount ?? 0}건`;
    text.appendChild(title);
    text.appendChild(meta);

    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  function updateVlmDatasetFolderPickerPanel(pickerElement, panelElement) {
    renderMultiVlmDatasetInfoPanel(panelElement, getCheckedDatasetPaths(pickerElement));
  }

  function populateVlmDatasetFolderPicker(pickerElement, panelElement, options = [], preferredPaths = []) {
    if (!pickerElement) return;
    vlmDatasetOptions = Array.isArray(options) ? options : [];
    const previousSelected = new Set(getCheckedDatasetPaths(pickerElement));
    const preferredSet = new Set([
      ...(Array.isArray(preferredPaths) ? preferredPaths : [preferredPaths].filter(Boolean)),
      ...previousSelected,
    ]);
    pickerElement.innerHTML = '';

    if (!vlmDatasetOptions.length) {
      pickerElement.innerHTML = '<p class="muted">dataset/vlm/{주제} 폴더가 없습니다.</p>';
      updateVlmDatasetFolderPickerPanel(pickerElement, panelElement);
      return;
    }

    vlmDatasetOptions.forEach((option) => {
      pickerElement.appendChild(buildVlmDatasetFolderOption(option, preferredSet));
    });

    if (!getCheckedDatasetPaths(pickerElement).length) {
      const fallback = vlmDatasetOptions[0];
      if (fallback) {
        const fallbackInput = pickerElement.querySelector(`input[value="${CSS.escape(fallback.datasetPath)}"]`);
        if (fallbackInput) fallbackInput.checked = true;
      }
    }
    updateVlmDatasetFolderPickerPanel(pickerElement, panelElement);
  }

  async function loadDatasetFolders(options = {}) {
    const scope = options.scope || 'all';
    const refresh = options.refresh === true;
    const detectorPicker = document.getElementById('trainingDatasetPathPicker');
    const vlmPicker = document.getElementById('trainingVlmDatasetPathPicker');
    const detectorPanel = document.getElementById('trainingDatasetInfoPanel');
    const vlmPanel = document.getElementById('trainingVlmDatasetInfoPanel');
    const refreshButtons = [
      document.getElementById('trainingDatasetRefreshButton'),
      document.getElementById('trainingVlmDatasetRefreshButton'),
    ];
    refreshButtons.forEach((button) => {
      if (button) button.disabled = true;
    });
    if (detectorPicker && (scope === 'all' || scope === 'detector')) {
      detectorPicker.setAttribute('aria-busy', 'true');
    }
    if (vlmPicker && (scope === 'all' || scope === 'vlm')) {
      vlmPicker.setAttribute('aria-busy', 'true');
    }

    try {
      const requests = [];
      if (scope === 'all' || scope === 'detector') {
        requests.push(fetchDetectorDatasetSuggestions(refresh).then((result) => ({ type: 'detector', result })));
      }
      if (scope === 'all' || scope === 'vlm') {
        requests.push(fetchVlmDatasetSuggestions(refresh).then((result) => ({ type: 'vlm', result })));
      }
      const responses = await Promise.all(requests);
      let detectorResult = options.detectorResult || null;
      let vlmResult = options.vlmResult || null;
      responses.forEach((item) => {
        if (item.type === 'detector') detectorResult = item.result;
        if (item.type === 'vlm') vlmResult = item.result;
      });

      if (detectorResult && (scope === 'all' || scope === 'detector')) {
        datasetOptions = detectorResult.options || [];
        populateDatasetFolderPicker(
          detectorPicker,
          detectorPanel,
          datasetOptions,
          options.preferredPaths
            || (options.preferredPath ? [options.preferredPath] : detectorResult.datasetPath ? [detectorResult.datasetPath] : []),
        );
        if (options.applySplitHints !== false && (detectorResult.trainPath || detectorResult.valPath)) {
          applySplitPaths(
            detectorResult.trainPath || '.',
            detectorResult.valPath || '.',
            detectorResult.splitSummary || '',
          );
        }
      }

      if (vlmResult && (scope === 'all' || scope === 'vlm')) {
        populateVlmDatasetFolderPicker(
          vlmPicker,
          vlmPanel,
          vlmResult.options || [],
          options.preferredVlmPaths
            || (options.vlmDatasetPath ? [options.vlmDatasetPath] : vlmResult.defaultDatasetPath ? [vlmResult.defaultDatasetPath] : []),
        );
      }

      return { ...detectorResult, vlm: vlmResult };
    } finally {
      refreshButtons.forEach((button) => {
        if (button) button.disabled = false;
      });
      if (detectorPicker) detectorPicker.removeAttribute('aria-busy');
      if (vlmPicker) vlmPicker.removeAttribute('aria-busy');
    }
  }

  function getSelectedDatasetPaths() {
    return getCheckedDatasetPaths(document.getElementById('trainingDatasetPathPicker'));
  }

  function getSelectedVlmDatasetPaths() {
    return getCheckedDatasetPaths(document.getElementById('trainingVlmDatasetPathPicker'));
  }

  function getPrimaryDatasetPath() {
    return getSelectedDatasetPaths()[0] || '';
  }

  async function refreshSplitPathSuggestions(options = {}) {
    const datasetPaths = options.datasetPaths
      || (options.datasetPath
        ? String(options.datasetPath).split(',').map((item) => item.trim()).filter(Boolean)
        : [])
      || getSelectedDatasetPaths();
    const datasetPath = datasetPaths.join(',');
    const modelName = options.modelName || getTrainingModelName();
    if (!datasetPath && !modelName) {
      return null;
    }
    try {
      const params = new URLSearchParams();
      if (datasetPath) params.set('datasetPath', datasetPath);
      if (modelName) params.set('modelName', modelName);
      const suggestions = await api.get(`/api/training/dataset-suggestions?${params.toString()}`);
      if (suggestions?.trainPath || suggestions?.valPath) {
        applySplitPaths(
          suggestions.trainPath || '',
          suggestions.valPath || '',
          suggestions.splitSummary || '',
        );
      }
      return suggestions;
    } catch (_error) {
      return null;
    }
  }

  function countClassDefinitionLines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')).length;
  }

  function updateClassDefinitionHint(text = '') {
    const hint = document.getElementById('trainingClassDefinitionPathHint');
    if (!hint) return;
    const count = countClassDefinitionLines(text);
    hint.textContent = count
      ? `클래스 ${count}개 · YAML names는 이 txt 내용으로 생성됩니다.`
      : '외부 txt 내용을 붙여넣거나 로컬 파일을 불러오세요. YAML names는 이 내용으로 생성됩니다.';
  }

  async function loadSuggestedClassDefinitionText(datasetPath) {
    if (!datasetPath) return;
    try {
      const result = await api.get(`/api/training/class-definition-files?datasetPath=${encodeURIComponent(datasetPath)}`);
      const textarea = document.getElementById('trainingClassDefinitionText');
      if (textarea && result?.suggestedContent) {
        textarea.value = result.suggestedContent;
        updateClassDefinitionHint(textarea.value);
      }
    } catch (_error) {
      // suggested class file is optional
    }
  }

  function formatWeightSize(sizeBytes) {
    if (!sizeBytes) return '';
    if (sizeBytes >= 1024 * 1024 * 1024) {
      return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    if (sizeBytes >= 1024 * 1024) {
      return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }

  function formatWeightOptionLabel(item) {
    const sizeLabel = formatWeightSize(item.sizeBytes);
    if (item.source === 'runs') {
      const label = `${item.runFolder}/${item.fileName || item.name}`;
      return sizeLabel ? `${label} (${sizeLabel})` : label;
    }
    return sizeLabel ? `${item.name} (${sizeLabel})` : item.name;
  }

  function appendWeightOptions(select, label, items) {
    if (!items.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    items.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.path;
      option.textContent = formatWeightOptionLabel(item);
      group.appendChild(option);
    });
    select.appendChild(group);
  }

  function populateWeightsSelect(weightsPayload) {
    const select = document.getElementById('trainingModelPathSelect');
    const weights = weightsPayload?.weights || [];
    const previousValue = selectedModelPath || select.value;
    const baseWeights = weights.filter((item) => item.source !== 'runs');
    const runWeights = weights.filter((item) => item.source === 'runs');

    select.innerHTML = '';
    if (!weights.length) {
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '사용 가능한 .pt 가중치가 없습니다';
      select.appendChild(emptyOption);
      return;
    }

    appendWeightOptions(
      select,
      weightsPayload.weightsRoot ? `기본 weights (${weightsPayload.weightsRoot})` : '기본 weights',
      baseWeights,
    );
    appendWeightOptions(
      select,
      weightsPayload.runsRoot ? `학습 runs (${weightsPayload.runsRoot})` : '학습 runs',
      runWeights,
    );

    const preferred = baseWeights.find((item) => item.name === 'yolo26l.pt')?.path
      || weights.find((item) => item.path === previousValue)?.path
      || baseWeights[0]?.path
      || runWeights[0]?.path
      || weights[0].path;
    select.value = preferred;
    selectedModelPath = preferred;
  }

  async function loadWeights(options = {}) {
    const select = document.getElementById('trainingModelPathSelect');
    const refreshButton = document.getElementById('trainingWeightsRefreshButton');
    select.disabled = true;
    refreshButton.disabled = true;
    try {
      const query = options.refresh ? '?refresh=1' : '';
      const result = await api.get(`/api/training/weights${query}`);
      populateWeightsSelect(result);
      const hint = document.getElementById('trainingWeightsRootHint');
      const hintParts = [];
      if (result.weightsRoot) {
        hintParts.push(`기본 weights: ${result.weightsRoot}`);
      }
      if (result.runsRoot) {
        hintParts.push(`학습 runs: ${result.runsRoot}`);
      }
      if (result.updatedAt) {
        hintParts.push(`갱신 ${result.updatedAt}`);
      }
      hint.textContent = hintParts.join(' · ');
      return result;
    } finally {
      select.disabled = false;
      refreshButton.disabled = false;
    }
  }

  function detectorParameters() {
    return normalizeTrainingDatasetParams(formToObject(getDetectorForm()));
  }

  function vlmParameters() {
    return normalizeTrainingDatasetParams(formToObject(getVlmForm()));
  }

  async function previewYaml() {
    const button = document.getElementById('trainingYamlPreviewButton');
    const previewPanel = document.getElementById('trainingYamlPreview');
    button.disabled = true;
    try {
      const result = await api.post('/api/training/dataset-config-preview', detectorParameters());
      if (result.relativeDatasetPath) {
        const preferredPaths = String(result.relativeDatasetPath)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        populateDatasetFolderPicker(
          document.getElementById('trainingDatasetPathPicker'),
          document.getElementById('trainingDatasetInfoPanel'),
          datasetOptions.length ? datasetOptions : preferredPaths.map((item) => ({ datasetPath: item })),
          preferredPaths,
        );
      }
      if (result.trainPath) {
        document.getElementById('trainingTrainPath').value = result.trainPath;
      }
      if (result.valPath) {
        document.getElementById('trainingValPath').value = result.valPath;
      }
      const warningText = result.warnings?.length
        ? `\n\n# warnings\n${result.warnings.map((item) => `# - ${item}`).join('\n')}`
        : '';
      const sourceText = result.classDefinitionSource === 'inline-text'
        ? '\n\n# class source\n# pasted txt content'
        : (result.relativeClassDefinitionPath ? `\n\n# class source\n# ${result.relativeClassDefinitionPath}` : '');
      const noteText = result.note ? `\n\n# note\n# ${result.note}` : '';
      previewPanel.textContent = `${result.yaml.trim()}${sourceText}${warningText}${noteText}`;
      showToast(`YAML 미리보기 생성 (${result.classNames.length} classes, images ${result.imageCount})`);
      return result;
    } catch (error) {
      previewPanel.textContent = `YAML 생성 실패\n\n${error.message || '알 수 없는 오류'}`;
      throw error;
    } finally {
      button.disabled = false;
    }
  }

  function waitMs(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function splitStatusLabel(status) {
    if (status === 'completed') return '완료';
    if (status === 'failed') return '실패';
    if (status === 'running') return '진행 중';
    if (status === 'queued' || status === 'accepted') return '대기/접수';
    return status || '대기';
  }

  async function pollAgentTask(taskId, options = {}) {
    const timeoutMs = options.timeoutMs || 120000;
    const intervalMs = options.intervalMs || 800;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const task = await api.get(`/api/training/agent-tasks/${encodeURIComponent(taskId)}`);
      renderSplitLog(task.logText || (task.logs || []).join('\n'), true);
      setSplitStatus(
        task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'failed' : 'running',
        splitStatusLabel(task.status),
      );
      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }
      await waitMs(intervalMs);
    }

    throw new Error(`작업 시간 초과 (${Math.round(timeoutMs / 1000)}s): ${taskId}`);
  }

  async function createDatasetSplit() {
    const button = document.getElementById('trainingDatasetSplitButton');
    const params = detectorParameters();
    button.disabled = true;
    const previousLabel = button.textContent;
    button.textContent = '생성 중...';
    setSplitStatus('running', '접수 중');
    renderSplitLog([
      '[START] 9:1 split 생성 요청',
      `[INFO] 학습명: ${params.name || '(미지정)'}`,
      `[INFO] 데이터셋: ${params.datasetPaths?.length ? params.datasetPaths.join(', ') : '(미지정)'}`,
      '[STEP] MLOps 서버에 명령 전송...',
    ], true);
    try {
      const accepted = await api.post('/api/training/dataset-split', params);
      const taskId = accepted.taskId || accepted.id;
      if (!taskId) {
        throw new Error('agent task ID를 받지 못했습니다.');
      }
      appendSplitLog(`[ OK ] 명령 접수 · taskId=${taskId}`);
      setSplitStatus('running', '실행 중');
      const task = await pollAgentTask(taskId);
      const result = task.result || task;
      if (task.status === 'failed') {
        throw Object.assign(new Error(task.errorMessage || 'split 생성 실패'), {
          logText: task.logText,
          logs: task.logs,
        });
      }
      applySplitPaths(result.trainPath, result.valPath);
      const remoteNote = result.remoteApplied === false ? ' · 로컬 생성' : ' · 학습 서버 반영';
      const folderNote = result.modelFolderName ? ` · ${result.modelFolderName}` : '';
      const warningNote = result.warnings?.length ? ` (${result.warnings.join(', ')})` : '';
      document.getElementById('trainingSplitPathHint').textContent =
        `${result.message || 'split 생성 완료'}${folderNote}${remoteNote}${warningNote}`;
      setSplitStatus('completed', '완료');
      showToast(result.message || '9:1 split을 생성했습니다.');
      return result;
    } catch (error) {
      appendSplitLog(`[ERR ] ${error.message || 'split 생성 실패'}`);
      if (error.logText) {
        renderSplitLog(error.logText, true);
      }
      setSplitStatus('failed', '실패');
      throw error;
    } finally {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }

  async function previewDetector() {
    const result = await api.post('/api/training/command-preview', detectorParameters());
    document.getElementById('trainingCommandPreview').textContent = result.command;
    return result;
  }

  async function startDetector() {
    const button = document.getElementById('trainingStartButton');
    button.disabled = true;
    try {
      const result = await api.post('/api/training/jobs', detectorParameters());
      document.getElementById('trainingCommandPreview').textContent = result.command;
      showToast(`학습 작업을 시작했습니다: ${result.name}`);
      global.MLOps.navigateTo('training-monitor-page');
      await global.MLOps.trainingMonitorController.loadJobs(result.id);
    } finally {
      button.disabled = false;
    }
  }

  async function previewVlm() {
    const result = await api.post('/api/training/command-preview', vlmParameters());
    document.getElementById('trainingVlmCommandPreview').textContent = result.command;
    return result;
  }

  async function startVlm() {
    const button = document.getElementById('trainingVlmStartButton');
    button.disabled = true;
    try {
      const result = await api.post('/api/training/jobs', vlmParameters());
      document.getElementById('trainingVlmCommandPreview').textContent = result.command;
      showToast(`학습 작업을 시작했습니다: ${result.name}`);
      global.MLOps.navigateTo('training-monitor-page');
      await global.MLOps.trainingMonitorController.loadJobs(result.id);
    } finally {
      button.disabled = false;
    }
  }

  function syncTrainingTypeTabs(activePageId) {
    document.querySelectorAll('.training-type-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.page === activePageId);
    });
  }

  function wireTrainingTypeTabs() {
    document.querySelectorAll('.training-type-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.dataset.page) {
          global.MLOps.navigateTo(tab.dataset.page);
        }
      });
    });
  }

  async function applyTrainingServerInfo(clientConfig, formSelector) {
    const trainingServerInput = document.querySelector(`${formSelector} [name="trainingServer"]`);
    if (!trainingServerInput) return;
    const mode = clientConfig.trainingExecutionMode || 'simulator';
    const isVlmForm = formSelector.includes('Vlm');
    const baseUrl = isVlmForm
      ? (clientConfig.vlmTrainingServerBaseUrl || clientConfig.trainingServerBaseUrl || '')
      : (clientConfig.trainingServerBaseUrl || '');
    try {
      const health = await api.get('/api/health');
      const agent = isVlmForm ? (health.vlmTrainingServer || {}) : (health.trainingServer || {});
      if (agent.status === 'ok') {
        const parts = [
          mode,
          baseUrl,
          agent.agentState ? `agent:${agent.agentState}` : '',
          agent.waitingForCommands ? 'REST대기' : '',
        ].filter(Boolean);
        trainingServerInput.value = parts.join(' · ');
        trainingServerInput.title = agent.supportedCommands
          ? `지원 명령: ${agent.supportedCommands.join(', ')}`
          : 'agent 재빌드 필요 (/api/v1/commands 없음)';
      } else {
        trainingServerInput.value = baseUrl ? `${mode} · ${baseUrl}` : mode;
      }
    } catch (_error) {
      trainingServerInput.value = baseUrl ? `${mode} · ${baseUrl}` : mode;
    }
  }

  function init() {
    wireTrainingTypeTabs();
    wireDetectorWizard();
    wireVlmWizard();
    document.getElementById('trainingYamlPreviewButton').addEventListener('click', () => previewYaml().catch(global.MLOps.handleError));
    document.getElementById('trainingPreviewButton').addEventListener('click', () => previewDetector().catch(global.MLOps.handleError));
    document.getElementById('trainingStartButton').addEventListener('click', () => startDetector().catch(global.MLOps.handleError));
    document.getElementById('trainingVlmPreviewButton').addEventListener('click', () => previewVlm().catch(global.MLOps.handleError));
    document.getElementById('trainingVlmStartButton').addEventListener('click', () => startVlm().catch(global.MLOps.handleError));
    document.getElementById('trainingModelPathSelect').addEventListener('change', (event) => {
      selectedModelPath = event.target.value;
    });
    document.getElementById('trainingDatasetPathPicker')?.addEventListener('change', (event) => {
      if (event.target.name !== 'datasetPaths') return;
      updateDatasetFolderPickerPanel(
        event.currentTarget,
        document.getElementById('trainingDatasetInfoPanel'),
        findDatasetOption,
      );
      refreshSplitPathSuggestions().catch(global.MLOps.handleError);
      loadSuggestedClassDefinitionText(getPrimaryDatasetPath()).catch(() => {});
    });
    document.getElementById('trainingVlmDatasetPathPicker')?.addEventListener('change', (event) => {
      if (event.target.name !== 'datasetPaths') return;
      updateVlmDatasetFolderPickerPanel(
        event.currentTarget,
        document.getElementById('trainingVlmDatasetInfoPanel'),
      );
    });
    document.getElementById('trainingDatasetRefreshButton').addEventListener('click', () => {
      loadDatasetFolders({ scope: 'detector', refresh: true })
        .then(() => showToast('데이터셋 목록을 갱신했습니다.'))
        .catch(global.MLOps.handleError);
    });
    document.getElementById('trainingVlmDatasetRefreshButton').addEventListener('click', () => {
      loadDatasetFolders({ scope: 'vlm', refresh: true })
        .then(() => showToast('데이터셋 목록을 갱신했습니다.'))
        .catch(global.MLOps.handleError);
    });
    document.querySelector('#trainingDetectorForm [name="name"]')?.addEventListener('change', () => {
      refreshSplitPathSuggestions().catch(global.MLOps.handleError);
    });
    document.getElementById('trainingDatasetSplitButton').addEventListener('click', () => {
      createDatasetSplit().catch(global.MLOps.handleError);
    });
    document.getElementById('trainingWeightsRefreshButton').addEventListener('click', () => {
      loadWeights({ refresh: true })
        .then(() => showToast('weights 목록을 갱신했습니다.'))
        .catch(global.MLOps.handleError);
    });
    document.getElementById('trainingClassDefinitionText').addEventListener('input', (event) => {
      updateClassDefinitionHint(event.target.value);
    });
    document.getElementById('trainingClassDefinitionFileInput').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const textarea = document.getElementById('trainingClassDefinitionText');
        textarea.value = text.trim();
        updateClassDefinitionHint(textarea.value);
        showToast(`${file.name} 내용을 불러왔습니다.`);
      } catch (error) {
        global.MLOps.handleError(error);
      } finally {
        event.target.value = '';
      }
    });
    document.getElementById('trainingClassDefinitionClearButton').addEventListener('click', () => {
      const textarea = document.getElementById('trainingClassDefinitionText');
      textarea.value = '';
      updateClassDefinitionHint('');
    });
  }

  async function configure(clientConfig) {
    let preferredPaths = [clientConfig.trainingDatasetPath || 'dataset/Integrated'];
    try {
      const detectorResult = await loadDatasetFolders({
        preferredPaths,
        scope: 'detector',
        applySplitHints: true,
      });
      if (detectorResult?.datasetPath) {
        preferredPaths = String(detectorResult.datasetPath)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      loadDatasetFolders({ scope: 'vlm' }).catch(() => {});
    } catch (_error) {
      await loadDatasetFolders({ preferredPaths, scope: 'detector' });
      loadDatasetFolders({ scope: 'vlm' }).catch(() => {});
    }

    document.getElementById('trainingOutputPath').value = clientConfig.trainingRunsRoot || 'detector/runs';
    const vlmOutputPath = document.querySelector('#trainingVlmForm [name="outputPath"]');
    if (vlmOutputPath && !vlmOutputPath.dataset.userEdited) {
      vlmOutputPath.value = 'vlm/runs';
    }
    const datasetConfigPath = document.getElementById('trainingDatasetConfigPath');
    if (datasetConfigPath) {
      const configRoot = clientConfig.trainingConfigsRoot || 'detector/configs';
      datasetConfigPath.value = joinRelativePath(configRoot, 'data.yaml');
    }
    setOutputPathHint(clientConfig.trainingWorkspaceRoot);
    applyTrainingServerInfo(clientConfig, '#trainingDetectorForm');
    applyTrainingServerInfo(clientConfig, '#trainingVlmForm');
    loadWeights().catch(() => {});
    loadSuggestedClassDefinitionText(getPrimaryDatasetPath()).catch(() => {});
    updateClassDefinitionHint(document.getElementById('trainingClassDefinitionText')?.value || '');
  }

  function onPageEnter(pageId) {
    syncTrainingTypeTabs(pageId);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    if (pageId === 'training-detector-settings-page') {
      resetDetectorWizard();
      loadWeights().catch(global.MLOps.handleError);
      if (!datasetSuggestionsCache) {
        loadDatasetFolders({ scope: 'detector' }).catch(global.MLOps.handleError);
      }
    }
    if (pageId === 'training-vlm-settings-page') {
      resetVlmWizard();
      if (!vlmDatasetSuggestionsCache) {
        loadDatasetFolders({ scope: 'vlm' }).catch(global.MLOps.handleError);
      }
    }
  }

  global.MLOps.trainingSettingsController = {
    init,
    configure,
    onPageEnter,
    loadWeights,
    loadDatasetFolders,
    createDatasetSplit,
    refreshSplitPathSuggestions,
    previewYaml,
    preview: previewDetector,
    start: startDetector,
  };
})(window);
