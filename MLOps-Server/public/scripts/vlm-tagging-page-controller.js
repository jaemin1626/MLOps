(function initializeVlmTaggingController(global) {
  'use strict';

  const DEFAULT_DATA_ROOT = '/workspace/dataset';
  const GPT_ANSWER_OPTIONS = ['판단불가', '아니요', '네'];
  const { api } = global.MLOps;
  const { escapeHtml, showToast } = global.MLOps.formatters;
  const state = {
    images: [],
    imageDirectory: '',
    jsonRoot: '',
    masterJsonPath: '',
    defaultHumanPrompt: '',
    currentIndex: -1,
    record: null,
    dirty: false,
    autoSaveTimer: null,
    folderBrowserPath: '',
    workMode: 'browse',
  };

  function isLabelingMode() {
    return state.workMode === 'labeling';
  }

  function navigationOptions() {
    return { focusAnswer: isLabelingMode() };
  }

  function blurActiveField() {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
  }

  function updateWorkModeUi() {
    const workspace = document.querySelector('.vlm-tagging-workspace');
    const modeSwitch = document.getElementById('vlmTaggingModeSwitch');
    document.querySelectorAll('.vlm-tagging-mode-btn').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.mode === state.workMode);
    });
    modeSwitch?.classList.toggle('is-mode-browse-active', !isLabelingMode());
    modeSwitch?.classList.toggle('is-mode-labeling-active', isLabelingMode());
    workspace?.classList.toggle('is-mode-labeling', isLabelingMode());
    workspace?.classList.toggle('is-mode-browse', !isLabelingMode());
  }

  function setWorkMode(mode, options = {}) {
    const nextMode = mode === 'labeling' ? 'labeling' : 'browse';
    state.workMode = nextMode;
    updateWorkModeUi();
    if (nextMode === 'browse') {
      blurActiveField();
    } else if (options.focusAnswer !== false && state.currentIndex >= 0) {
      focusAnswerField();
    }
    if (!options.silent) {
      showToast(nextMode === 'labeling' ? '라벨링 모드' : '이미지 확인 모드', 'info');
    }
  }

  function toggleWorkMode(options = {}) {
    setWorkMode(isLabelingMode() ? 'browse' : 'labeling', options);
  }

  function configuredDataRoot() {
    return global.MLOps.clientConfig?.dataRoot || DEFAULT_DATA_ROOT;
  }

  function configuredVlmImagesRoot() {
    return global.MLOps.clientConfig?.defaultVlmImagesDatasetPath
      || global.MLOps.clientConfig?.vlmImagesRoot
      || `${configuredDataRoot()}/vlm`;
  }

  function getImageDirectoryInput() {
    return document.getElementById('vlmTaggingImageDirectory');
  }

  function getHumanPromptInput() {
    return document.getElementById('vlmTaggingHumanPrompt');
  }

  function getGptDescriptionInput() {
    return document.getElementById('vlmTaggingGptDescription');
  }

  function getGptAnswerInput() {
    return document.getElementById('vlmTaggingAnswerText');
  }

  function getSelectedGptAnswer() {
    return document.querySelector('input[name="vlmTaggingAnswer"]:checked')?.value || '';
  }

  function setSelectedGptAnswer(answer) {
    document.querySelectorAll('input[name="vlmTaggingAnswer"]').forEach((input) => {
      input.checked = input.value === answer;
    });
  }

  function resolveAnswerTheme(answer) {
    const normalized = String(answer || '').trim();
    if (!normalized) {
      return 'empty';
    }
    if (normalized === '네') {
      return 'yes';
    }
    if (normalized === '아니요' || normalized === '아니오') {
      return 'no';
    }
    if (normalized === '판단불가') {
      return 'unknown';
    }
    return 'custom';
  }

  function updateResponseBlockTheme(answer) {
    const block = document.getElementById('vlmTaggingResponseBlock');
    if (!block) {
      return;
    }
    block.classList.remove(
      'is-answer-empty',
      'is-answer-yes',
      'is-answer-no',
      'is-answer-unknown',
      'is-answer-custom',
    );
    block.classList.add(`is-answer-${resolveAnswerTheme(answer)}`);
  }

  function getGptAnswerFromForm() {
    return getGptAnswerInput()?.value.trim() || getSelectedGptAnswer() || '';
  }

  function setGptAnswerField(answer) {
    const normalized = String(answer || '').trim();
    if (getGptAnswerInput()) {
      getGptAnswerInput().value = normalized;
    }
    setSelectedGptAnswer(GPT_ANSWER_OPTIONS.includes(normalized) ? normalized : '');
    updateResponseBlockTheme(normalized);
  }

  function parseGptResponseValue(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return { answer: '', description: '' };
    }
    for (const answer of GPT_ANSWER_OPTIONS) {
      if (!trimmed.startsWith(answer)) {
        continue;
      }
      let rest = trimmed.slice(answer.length).trim();
      if (rest.startsWith(',')) {
        rest = rest.slice(1).trim();
      }
      return { answer, description: rest };
    }
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex > 0) {
      return {
        answer: trimmed.slice(0, commaIndex).trim(),
        description: trimmed.slice(commaIndex + 1).trim(),
      };
    }
    return { answer: trimmed, description: '' };
  }

  function buildGptResponseValue(answer, description) {
    const normalizedAnswer = String(answer || '').trim();
    const normalizedDescription = String(description || '').trim();
    if (!normalizedAnswer && !normalizedDescription) {
      return '';
    }
    if (!normalizedAnswer) {
      return normalizedDescription;
    }
    if (!normalizedDescription) {
      return normalizedAnswer;
    }
    return `${normalizedAnswer}, ${normalizedDescription}`;
  }

  function buildGptValueFromForm() {
    return buildGptResponseValue(
      getGptAnswerFromForm(),
      getGptDescriptionInput()?.value || '',
    );
  }

  function syncGptFormFromValue(value) {
    const parsed = parseGptResponseValue(value);
    setGptAnswerField(parsed.answer);
    if (getGptDescriptionInput()) {
      getGptDescriptionInput().value = parsed.description;
    }
  }

  function handleAnswerRadioChange(event) {
    if (!event.target.checked) {
      return;
    }
    setGptAnswerField(event.target.value);
    markDirty();
  }

  function handleAnswerTextInput() {
    const answer = getGptAnswerInput()?.value.trim() || '';
    setSelectedGptAnswer(GPT_ANSWER_OPTIONS.includes(answer) ? answer : '');
    updateResponseBlockTheme(answer);
    markDirty();
  }

  function updateJsonPreview() {
    const preview = document.getElementById('vlmTaggingJsonPreview');
    const pathElement = document.getElementById('vlmTaggingJsonPreviewPath');
    const jsonPath = state.masterJsonPath
      || `${state.labelDir || state.jsonRoot || `${configuredDataRoot()}/vlm`}/label/conversations.json`;
    if (pathElement) {
      pathElement.textContent = `${jsonPath} · 배열 형식으로 누적 저장`;
    }
    if (!preview) {
      return;
    }
    const record = buildRecordFromForm();
    if (!record) {
      preview.textContent = '[\n  /* 이미지를 선택하면 저장 형식이 표시됩니다 */\n]';
      return;
    }
    preview.textContent = JSON.stringify([record], null, 4);
  }

  function resolveImageDirectory() {
    const input = getImageDirectoryInput();
    const value = input?.value.trim() || configuredVlmImagesRoot();
    if (input) {
      input.value = value;
    }
    return value;
  }

  function toggleImageFolderPanel(forceOpen) {
    const panel = document.getElementById('vlmTaggingImageFolderPanel');
    if (!panel) {
      return;
    }
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !shouldOpen);
    if (shouldOpen) {
      const input = getImageDirectoryInput();
      if (input && !input.value.trim()) {
        input.value = configuredVlmImagesRoot();
      }
      input?.focus();
      input?.select();
    }
  }

  function updateFolderSummaryText() {
    const element = document.getElementById('vlmTaggingFolderSummaryText');
    if (!element) {
      return;
    }
    const imageDirectory = resolveImageDirectory();
    const labelRoot = state.labelDir || state.jsonRoot || `${configuredDataRoot()}/vlm`;
    element.textContent = `이미지: ${imageDirectory} · label 저장: ${state.masterJsonPath || `${labelRoot}/label/conversations.json`}`;
  }

  function buildRecordFromForm() {
    const imageItem = state.images[state.currentIndex];
    if (!imageItem) {
      return null;
    }
    return {
      index: imageItem.index,
      image: imageItem.imageRelativePath,
      conversations: [
        { from: 'human', value: getHumanPromptInput()?.value || state.defaultHumanPrompt || '' },
        { from: 'gpt', value: buildGptValueFromForm() },
      ],
    };
  }

  function syncFormFromRecord(record) {
    const humanEntry = record?.conversations?.find((entry) => entry.from === 'human');
    const gptEntry = record?.conversations?.find((entry) => entry.from === 'gpt');
    if (getHumanPromptInput()) {
      getHumanPromptInput().value = humanEntry?.value || state.defaultHumanPrompt || '';
    }
    syncGptFormFromValue(gptEntry?.value || '');
    const indexElement = document.getElementById('vlmTaggingRecordIndex');
    const imageElement = document.getElementById('vlmTaggingRecordImagePath');
    if (indexElement) {
      indexElement.textContent = record?.index || '-';
    }
    if (imageElement) {
      imageElement.textContent = record?.image || '-';
    }
    updateJsonPreview();
  }

  function markDirty() {
    state.dirty = true;
    updateJsonPreview();
    const status = document.getElementById('vlmTaggingSaveStatus');
    if (status) {
      status.textContent = '저장되지 않은 변경사항이 있습니다.';
    }
    if (state.autoSaveTimer) {
      clearTimeout(state.autoSaveTimer);
    }
    state.autoSaveTimer = setTimeout(() => {
      saveCurrentRecord().catch(global.MLOps.handleError);
    }, 900);
  }

  async function saveCurrentRecord(options = {}) {
    if (state.currentIndex < 0 || !state.images[state.currentIndex]) {
      return null;
    }
    if (!state.dirty && !options.force) {
      return null;
    }
    const imageItem = state.images[state.currentIndex];
    const record = buildRecordFromForm();
    const result = await api.post('/api/vlm-tagging/record', {
      imagePath: imageItem.path,
      imageDirectory: state.imageDirectory || resolveImageDirectory(),
      record,
      humanPrompt: getHumanPromptInput()?.value || '',
    });
    state.record = result.record;
    state.dirty = false;
    imageItem.hasLabel = result.hasLabel;
    imageItem.index = result.record.index;
    renderImageList();
    const status = document.getElementById('vlmTaggingSaveStatus');
    if (status) {
      status.textContent = `JSON 저장 완료 · ${result.masterJsonPath}`;
    }
    updateJsonPreview();
    return result;
  }

  function renderImagePreview(imageItem) {
    const preview = document.getElementById('vlmTaggingImagePreview');
    if (!preview || !imageItem) {
      return;
    }
    preview.src = `${imageItem.imageUrl}&t=${Date.now()}`;
    preview.alt = imageItem.name;
  }

  function focusAnswerField() {
    const input = getGptAnswerInput();
    if (!input || !document.getElementById('vlm-tagging-page')?.classList.contains('active')) {
      return;
    }
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
  }

  async function selectImage(index, options = {}) {
    if (index < 0 || index >= state.images.length) {
      return;
    }
    if (state.dirty) {
      await saveCurrentRecord({ force: true });
    }
    state.currentIndex = index;
    const imageItem = state.images[index];
    document.querySelectorAll('.vlm-tagging-image-button').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.index) === index);
    });
    document.getElementById('vlmTaggingPosition').textContent = `${index + 1} / ${state.images.length}`;
    document.getElementById('vlmTaggingSaveStatus').textContent = 'JSON을 불러오는 중입니다.';
    renderImagePreview(imageItem);
    const result = await api.get(
      `/api/vlm-tagging/record?imagePath=${encodeURIComponent(imageItem.path)}`
      + `&imageDirectory=${encodeURIComponent(state.imageDirectory || resolveImageDirectory())}`
      + `&humanPrompt=${encodeURIComponent(getHumanPromptInput()?.value || state.defaultHumanPrompt || '')}`,
    );
    state.record = result.record;
    imageItem.index = result.record.index;
    imageItem.hasLabel = result.hasLabel;
    syncFormFromRecord(result.record);
    state.dirty = false;
    document.getElementById('vlmTaggingSaveStatus').textContent = result.hasLabel
      ? `라벨 있음 · ${result.masterJsonPath}`
      : `라벨 없음 · ${result.masterJsonPath}`;
    renderImageList();
    updateJsonPreview();
    if (options.focusAnswer) {
      focusAnswerField();
    } else {
      blurActiveField();
    }
  }

  function renderImageList() {
    const container = document.getElementById('vlmTaggingImageList');
    if (!container) {
      return;
    }
    if (!state.images.length) {
      container.innerHTML = '<div class="muted" style="padding:12px">이미지가 없습니다.</div>';
      document.getElementById('vlmTaggingImageCount').textContent = '0장';
      return;
    }
    const labeledCount = state.images.filter((image) => image.hasLabel).length;
    container.innerHTML = state.images.map((image, index) => `
      <button type="button" class="tagging-image-button vlm-tagging-image-button ${index === state.currentIndex ? 'active' : ''}" data-index="${index}" title="${escapeHtml(image.path)}">
        <span class="tagging-image-button-title">${index + 1}. ${escapeHtml(image.name)}</span>
        <span class="tagging-image-badge ${image.hasLabel ? 'labeled' : 'empty'}">${image.hasLabel ? '라벨 있음' : '라벨 없음'}</span>
      </button>
    `).join('');
    container.querySelectorAll('.vlm-tagging-image-button').forEach((button) => {
      button.addEventListener('click', () => selectImage(Number(button.dataset.index)).catch(global.MLOps.handleError));
    });
    document.getElementById('vlmTaggingImageCount').textContent = `${state.images.length}장 · 라벨 ${labeledCount}장`;
  }

  async function loadImages() {
    const imageDirectory = resolveImageDirectory();
    state.imageDirectory = imageDirectory;
    const result = await api.get(`/api/vlm-tagging/images?imageDirectory=${encodeURIComponent(imageDirectory)}`);
    state.images = result.images || [];
    state.topicName = result.topicName || '';
    state.labelDir = result.labelDir || result.jsonRoot || '';
    state.jsonRoot = state.labelDir;
    state.masterJsonPath = result.masterJsonPath || result.labelFile || '';
    state.defaultHumanPrompt = result.defaultHumanPrompt || '';
    if (!getHumanPromptInput()?.value.trim() && state.defaultHumanPrompt) {
      getHumanPromptInput().value = state.defaultHumanPrompt;
    }
    renderImageList();
    updateFolderSummaryText();
    if (!state.images.length) {
      document.getElementById('vlmTaggingSaveStatus').textContent = '선택한 폴더에 이미지가 없습니다.';
      renderImagePreview(null);
      updateJsonPreview();
      return;
    }
    await selectImage(0);
  }

  async function applyImageFolderPath() {
    toggleImageFolderPanel(false);
    await loadImages();
    showToast(`${state.images.length}장의 VLM 이미지를 불러왔습니다.`);
  }

  async function renderFolderBrowser(directory) {
    const pathElement = document.getElementById('vlmTaggingFolderBrowserPath');
    const listElement = document.getElementById('vlmTaggingFolderBrowserList');
    const result = await api.get(`/api/vlm-tagging/folders?directory=${encodeURIComponent(directory)}`);
    state.folderBrowserPath = result.currentPath;
    if (pathElement) {
      pathElement.textContent = result.currentPath;
    }
    const items = [];
    if (result.parentPath && result.parentPath !== result.currentPath) {
      items.push(`<button type="button" class="tagging-class-browser-item" data-directory="${escapeHtml(result.parentPath)}"><span>..</span><span class="item-meta">상위 폴더</span></button>`);
    }
    (result.directories || []).forEach((entry) => {
      items.push(`<button type="button" class="tagging-class-browser-item" data-directory="${escapeHtml(entry.path)}"><span>${escapeHtml(entry.name)}</span><span class="item-meta">폴더</span></button>`);
    });
    if (listElement) {
      listElement.innerHTML = items.join('') || '<div class="muted" style="padding:12px">하위 폴더가 없습니다.</div>';
      listElement.querySelectorAll('[data-directory]').forEach((button) => {
        button.addEventListener('click', () => renderFolderBrowser(button.dataset.directory).catch(global.MLOps.handleError));
      });
    }
  }

  function openFolderModal() {
    const modal = document.getElementById('vlmTaggingFolderModal');
    modal?.classList.remove('hidden');
    renderFolderBrowser(resolveImageDirectory() || configuredDataRoot()).catch(global.MLOps.handleError);
  }

  function closeFolderModal() {
    document.getElementById('vlmTaggingFolderModal')?.classList.add('hidden');
  }

  function selectCurrentFolder() {
    const input = getImageDirectoryInput();
    if (input) {
      input.value = state.folderBrowserPath || resolveImageDirectory();
    }
    closeFolderModal();
    applyImageFolderPath().catch(global.MLOps.handleError);
  }

  function handleDescriptionKeydown(event) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    const descriptionInput = getGptDescriptionInput();
    descriptionInput?.blur();
    if (state.dirty) {
      saveCurrentRecord({ force: true }).catch(global.MLOps.handleError);
    }
  }

  function handleKeydown(event) {
    if (!document.getElementById('vlm-tagging-page')?.classList.contains('active')) {
      return;
    }
    if (event.key === 'L' && event.shiftKey && event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      toggleWorkMode();
      return;
    }
    const target = event.target;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
      if (event.key === 'ArrowLeft' && event.altKey) {
        event.preventDefault();
        selectImage(state.currentIndex - 1, navigationOptions()).catch(global.MLOps.handleError);
      }
      if (event.key === 'ArrowRight' && event.altKey) {
        event.preventDefault();
        selectImage(state.currentIndex + 1, navigationOptions()).catch(global.MLOps.handleError);
      }
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectImage(state.currentIndex - 1, navigationOptions()).catch(global.MLOps.handleError);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectImage(state.currentIndex + 1, navigationOptions()).catch(global.MLOps.handleError);
    }
  }

  function init() {
    document.getElementById('vlmTaggingSelectImageFolderButton')?.addEventListener('click', () => toggleImageFolderPanel());
    document.getElementById('vlmTaggingApplyImagePathButton')?.addEventListener('click', () => applyImageFolderPath().catch(global.MLOps.handleError));
    document.getElementById('vlmTaggingBrowseImageFolderButton')?.addEventListener('click', openFolderModal);
    document.getElementById('vlmTaggingFolderModalClose')?.addEventListener('click', closeFolderModal);
    document.getElementById('vlmTaggingSelectCurrentFolderButton')?.addEventListener('click', selectCurrentFolder);
    document.getElementById('vlmTaggingFolderModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'vlmTaggingFolderModal') {
        closeFolderModal();
      }
    });
    document.getElementById('vlmTaggingPreviousButton')?.addEventListener('click', () => selectImage(state.currentIndex - 1, navigationOptions()).catch(global.MLOps.handleError));
    document.getElementById('vlmTaggingNextButton')?.addEventListener('click', () => selectImage(state.currentIndex + 1, navigationOptions()).catch(global.MLOps.handleError));
    document.getElementById('vlmTaggingModeBrowse')?.addEventListener('click', () => setWorkMode('browse'));
    document.getElementById('vlmTaggingModeLabeling')?.addEventListener('click', () => setWorkMode('labeling'));
    document.getElementById('vlmTaggingSaveButton')?.addEventListener('click', () => {
      saveCurrentRecord({ force: true }).then(() => showToast('VLM JSON 저장 완료')).catch(global.MLOps.handleError);
    });
    document.getElementById('vlmTaggingApplyPromptButton')?.addEventListener('click', () => {
      if (state.defaultHumanPrompt) {
        getHumanPromptInput().value = state.defaultHumanPrompt;
        markDirty();
      }
    });
    getHumanPromptInput()?.addEventListener('input', markDirty);
    getGptDescriptionInput()?.addEventListener('input', markDirty);
    getGptDescriptionInput()?.addEventListener('keydown', handleDescriptionKeydown);
    getGptAnswerInput()?.addEventListener('input', handleAnswerTextInput);
    document.querySelectorAll('input[name="vlmTaggingAnswer"]').forEach((input) => {
      input.addEventListener('change', handleAnswerRadioChange);
    });
    window.addEventListener('keydown', handleKeydown);
    setWorkMode('browse', { silent: true, focusAnswer: false });
  }

  function configure(clientConfig) {
    const imageInput = getImageDirectoryInput();
    if (imageInput && !imageInput.value.trim()) {
      imageInput.value = clientConfig?.defaultVlmImagesDatasetPath
        || clientConfig?.vlmImagesRoot
        || configuredVlmImagesRoot();
    }
    if (getHumanPromptInput() && !getHumanPromptInput().value.trim()) {
      getHumanPromptInput().value = '';
    }
    updateFolderSummaryText();
    updateResponseBlockTheme('');
    updateJsonPreview();
  }

  global.MLOps.vlmTaggingController = {
    init,
    configure,
    loadImages,
  };
})(window);