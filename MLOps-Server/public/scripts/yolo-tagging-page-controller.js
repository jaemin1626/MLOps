(function initializeYoloTaggingController(global) {
  'use strict';

  const DEFAULT_DATA_ROOT = '/workspace/dataset';
  const { api } = global.MLOps;
  const { escapeHtml, showToast } = global.MLOps.formatters;
  const state = {
    images: [],
    classes: [],
    classesFilePath: '',
    classesFileSource: '',
    imageDirectory: '',
    currentIndex: -1,
    boxes: [],
    selectedIndex: -1,
    image: new Image(),
    pointerAction: null,
    dirty: false,
    autoSaveTimer: null,
    classFileBrowserPath: '',
    folderBrowserPath: '',
    hoverPoint: null,
  };
  let canvas;
  let context;
  let canvasViewport;
  let stageCard;
  let expandCanvasButton;
  let canvasExpanded = false;
  let pseudoRunFolders = [];
  let pseudoPtFiles = [];
  let pseudoBaseWeights = [];

  const boxColors = ['#39a0ff', '#4bc97b', '#a66bff', '#ffaf3d', '#ff5b4f', '#20c5c7'];

  function getImageDirectoryInput() {
    return document.getElementById('taggingImageDirectory');
  }

  function getClassesFilePathInput() {
    return document.getElementById('taggingClassesFilePath');
  }

  function getClassesSource() {
    return document.querySelector('input[name="taggingClassesSource"]:checked')?.value || 'server';
  }

  function syncClassesSourcePanels() {
    const source = getClassesSource();
    document.getElementById('taggingClassesServerPanel')?.classList.toggle('hidden', source !== 'server');
    document.getElementById('taggingClassesLocalPanel')?.classList.toggle('hidden', source !== 'local');
  }

  function getClassesFilePanel() {
    return document.getElementById('taggingClassesFilePanel');
  }

  function getImageFolderPanel() {
    return document.getElementById('taggingImageFolderPanel');
  }

  function getPseudoLabelPanel() {
    return document.getElementById('taggingPseudoLabelPanel');
  }

  function getPseudoToggleButton() {
    return document.getElementById('taggingTogglePseudoPanelButton');
  }

  function configuredDataRoot() {
    return global.MLOps.clientConfig?.dataRoot || DEFAULT_DATA_ROOT;
  }

  function togglePanel(panel, forceOpen) {
    if (!panel) {
      return false;
    }
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !shouldOpen);
    return shouldOpen;
  }

  function closeOtherPathPanels(exceptPanel) {
    [getImageFolderPanel(), getClassesFilePanel(), getPseudoLabelPanel()].forEach((panel) => {
      if (panel && panel !== exceptPanel) {
        panel.classList.add('hidden');
      }
    });
    if (exceptPanel !== getPseudoLabelPanel()) {
      getPseudoToggleButton()?.classList.remove('is-open');
      getPseudoToggleButton()?.setAttribute('aria-expanded', 'false');
    }
  }

  function focusPanelInput(input, defaultValue) {
    if (!input) {
      return;
    }
    if (!input.value.trim() && defaultValue) {
      input.value = defaultValue;
    }
    input.focus();
    input.select();
  }

  function resolveClassesFilePath() {
    const input = getClassesFilePathInput();
    return input?.value.trim() || '';
  }

  function syncClassesFilePathInput(filePath) {
    const input = getClassesFilePathInput();
    if (input && filePath) {
      input.value = filePath;
    }
  }

  function defaultClassesFilePath() {
    const imageDirectory = resolveImageDirectory();
    const folderName = imageDirectory.split('/').filter(Boolean).pop() || 'classes';
    const classFolderRoot = global.MLOps.clientConfig?.classFolderRoot || `${configuredDataRoot()}/detector/class_folder`;
    return `${classFolderRoot}/${folderName.toLowerCase()}.txt`;
  }

  function toggleClassesFilePanel(forceOpen) {
    const panel = getClassesFilePanel();
    closeOtherPathPanels(panel);
    const shouldOpen = togglePanel(panel, forceOpen);
    if (shouldOpen) {
      syncClassesSourcePanels();
      if (getClassesSource() === 'server') {
        focusPanelInput(getClassesFilePathInput(), defaultClassesFilePath());
      }
    }
  }

  function toggleImageFolderPanel(forceOpen) {
    const panel = getImageFolderPanel();
    closeOtherPathPanels(panel);
    const shouldOpen = togglePanel(panel, forceOpen);
    if (shouldOpen) {
      focusPanelInput(getImageDirectoryInput(), global.MLOps.clientConfig?.detectorImagesRoot || configuredDataRoot());
    }
  }

  let pseudoPanelInitialized = false;

  async function ensurePseudoPanelData() {
    if (pseudoPanelInitialized) {
      return;
    }
    pseudoPanelInitialized = true;
    await Promise.all([
      loadPseudoRunFolders().catch(() => {}),
      loadPseudoBaseWeights().catch(() => {}),
    ]);
  }

  function togglePseudoLabelPanel(forceOpen) {
    const panel = getPseudoLabelPanel();
    const toggleButton = getPseudoToggleButton();
    closeOtherPathPanels(panel);
    const shouldOpen = togglePanel(panel, forceOpen);
    toggleButton?.classList.toggle('is-open', shouldOpen);
    toggleButton?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
      syncPseudoModelPanels();
      ensurePseudoPanelData().catch(global.MLOps.handleError);
    }
  }

  function resolveImageDirectory() {
    const input = getImageDirectoryInput();
    const value = input?.value.trim() || configuredDataRoot();
    if (input) {
      input.value = value;
    }
    return value;
  }

  function updateFolderSummaryText() {
    const element = document.getElementById('taggingFolderSummaryText');
    if (!element) {
      return;
    }
    const classText = state.classesFilePath
      ? `클래스: ${state.classesFilePath}${state.classesFileSource === 'local' ? ' (로컬 PC)' : ' (서버)'}`
      : '클래스 파일 미선택';
    element.textContent = `이미지 폴더: ${resolveImageDirectory()} · 라벨 저장: 이미지와 같은 폴더 · ${classText}`;
  }

  function applyClassesFromFile(result) {
    state.classes = result.classes || [];
    state.classesFilePath = result.path || result.fileName || '';
    state.classesFileSource = result.source === 'inline-text' ? 'local' : 'server';
    if (state.classesFileSource === 'server') {
      syncClassesFilePathInput(state.classesFilePath);
    }
    renderClassSelect();
    updateFolderSummaryText();
    updateSummary();
    const sourceLabel = state.classesFileSource === 'local' ? '로컬 PC' : '서버';
    showToast(`클래스 ${state.classes.length}개를 적용했습니다 (${sourceLabel} · ${result.fileName || 'classes.txt'})`);
  }

  function renderClassFileBrowser(result) {
    const pathElement = document.getElementById('taggingClassFileBrowserPath');
    const listElement = document.getElementById('taggingClassFileBrowserList');
    if (!pathElement || !listElement) {
      return;
    }
    state.classFileBrowserPath = result.currentPath;
    pathElement.textContent = result.currentPath;
    const items = [];
    if (result.parentPath && result.parentPath !== result.currentPath) {
      items.push(`<button type="button" class="tagging-class-browser-item" data-directory="${escapeHtml(result.parentPath)}"><span>..</span><span class="item-meta">상위 폴더</span></button>`);
    }
    (result.directories || []).forEach((directory) => {
      items.push(`<button type="button" class="tagging-class-browser-item" data-directory="${escapeHtml(directory.path)}"><span>${escapeHtml(directory.name)}</span><span class="item-meta">폴더</span></button>`);
    });
    (result.files || []).forEach((file) => {
      const disabled = file.isClassDefinition ? '' : ' disabled';
      const meta = file.isClassDefinition ? '선택' : 'bbox txt';
      items.push(`<button type="button" class="tagging-class-browser-item${disabled}" data-file="${escapeHtml(file.path)}" ${file.isClassDefinition ? '' : 'disabled'}><span>${escapeHtml(file.name)}</span><span class="item-meta">${meta}</span></button>`);
    });
    listElement.innerHTML = items.length
      ? items.join('')
      : '<div class="muted" style="padding:12px">이 폴더에 txt 파일이 없습니다.</div>';
    listElement.querySelectorAll('[data-directory]').forEach((button) => {
      button.addEventListener('click', () => browseClassFiles(button.dataset.directory).catch(global.MLOps.handleError));
    });
    listElement.querySelectorAll('[data-file]').forEach((button) => {
      button.addEventListener('click', () => selectClassFile(button.dataset.file).catch(global.MLOps.handleError));
    });
  }

  async function browseClassFiles(directoryPath) {
    const directory = directoryPath || resolveImageDirectory();
    const result = await api.get(`/api/tagging/class-files?directory=${encodeURIComponent(directory)}`);
    renderClassFileBrowser(result);
  }

  async function selectClassFile(filePath) {
    const result = await api.post('/api/tagging/classes-file', { path: filePath });
    applyClassesFromFile(result);
    closeClassFileModal();
  }

  async function loadClassesFromPath() {
    if (getClassesSource() === 'local') {
      await loadClassesFromLocalFile();
      return;
    }
    const filePath = resolveClassesFilePath();
    if (!filePath) {
      showToast('클래스 txt 파일 경로를 입력하세요.');
      toggleClassesFilePanel(true);
      return;
    }
    await selectClassFile(filePath);
  }

  async function loadClassesFromLocalFile() {
    const fileInput = document.getElementById('taggingClassesLocalFileInput');
    const file = fileInput?.files?.[0];
    if (!file) {
      showToast('로컬 PC에서 txt 파일을 선택하세요.');
      toggleClassesFilePanel(true);
      syncClassesSourcePanels();
      return;
    }
    const text = await file.text();
    const result = await api.post('/api/tagging/classes-text', {
      text,
      fileName: file.name,
    });
    applyClassesFromFile(result);
    toggleClassesFilePanel(false);
  }

  function openClassFileModal() {
    const modal = document.getElementById('taggingClassFileModal');
    if (!modal) {
      return;
    }
    modal.classList.remove('hidden');
    const filePath = resolveClassesFilePath();
    const classFolder = `${configuredDataRoot()}/class_folder`;
    const startDirectory = filePath
      ? filePath.replace(/\/[^/]+$/, '')
      : (resolveImageDirectory().includes('/Images/')
        ? classFolder
        : classFolder);
    browseClassFiles(startDirectory).catch(global.MLOps.handleError);
  }

  function handleLoadClassesButtonClick() {
    toggleClassesFilePanel();
  }

  function renderFolderBrowser(result) {
    const pathElement = document.getElementById('taggingFolderBrowserPath');
    const listElement = document.getElementById('taggingFolderBrowserList');
    if (!pathElement || !listElement) {
      return;
    }
    state.folderBrowserPath = result.currentPath;
    pathElement.textContent = result.currentPath;
    const items = [];
    if (result.parentPath && result.parentPath !== result.currentPath) {
      items.push(`<button type="button" class="tagging-class-browser-item" data-directory="${escapeHtml(result.parentPath)}"><span>..</span><span class="item-meta">상위 폴더</span></button>`);
    }
    (result.directories || []).forEach((directory) => {
      items.push(`<button type="button" class="tagging-class-browser-item" data-directory="${escapeHtml(directory.path)}"><span>${escapeHtml(directory.name)}</span><span class="item-meta">폴더</span></button>`);
    });
    listElement.innerHTML = items.length
      ? items.join('')
      : '<div class="muted" style="padding:12px">하위 폴더가 없습니다. 현재 폴더를 선택하세요.</div>';
    listElement.querySelectorAll('[data-directory]').forEach((button) => {
      button.addEventListener('click', () => browseFolders(button.dataset.directory).catch(global.MLOps.handleError));
    });
  }

  async function browseFolders(directoryPath) {
    const directory = directoryPath || configuredDataRoot();
    const result = await api.get(`/api/tagging/folders?directory=${encodeURIComponent(directory)}`);
    renderFolderBrowser(result);
  }

  function applyFolderSelection(directoryPath) {
    getImageDirectoryInput().value = directoryPath;
    updateFolderSummaryText();
    closeFolderModal();
    loadImages().catch(global.MLOps.handleError);
  }

  function selectCurrentFolder() {
    if (!state.folderBrowserPath) {
      return;
    }
    applyFolderSelection(state.folderBrowserPath);
  }

  function openFolderModal() {
    const modal = document.getElementById('taggingFolderModal');
    const title = document.getElementById('taggingFolderModalTitle');
    if (!modal) {
      return;
    }
    if (title) {
      title.textContent = '이미지 폴더 선택';
    }
    modal.classList.remove('hidden');
    browseFolders(resolveImageDirectory()).catch(global.MLOps.handleError);
  }

  function closeFolderModal() {
    document.getElementById('taggingFolderModal')?.classList.add('hidden');
  }

  async function applyImageFolderPath() {
    const directoryPath = getImageDirectoryInput()?.value.trim();
    if (!directoryPath) {
      showToast('이미지 폴더 경로를 입력하세요.');
      toggleImageFolderPanel(true);
      return;
    }
    await api.get(`/api/tagging/folders?directory=${encodeURIComponent(directoryPath)}`);
    toggleImageFolderPanel(false);
    updateFolderSummaryText();
    await loadImages();
  }

  function closeClassFileModal() {
    document.getElementById('taggingClassFileModal')?.classList.add('hidden');
  }

  function imageDisplayName(image) {
    return image.relativePath && image.relativePath !== image.name
      ? image.relativePath
      : image.name;
  }

  function truncateStatusPath(path, maxLength = 48) {
    const text = String(path || '').trim();
    if (!text || text.length <= maxLength) {
      return text;
    }
    const fileName = text.split('/').pop() || text;
    if (fileName.length <= maxLength) {
      return fileName;
    }
    return `${fileName.slice(0, 18)}…${fileName.slice(-20)}`;
  }

  function setSaveStatus(kind, message, detail = '') {
    const container = document.getElementById('taggingSaveStatus');
    if (!container) {
      return;
    }
    container.className = `tagging-save-status${kind ? ` is-${kind}` : ''}`;
    container.innerHTML = `
      <span class="tagging-save-status__message">${escapeHtml(message)}</span>
      ${detail ? `<span class="tagging-save-status__detail monospace" title="${escapeHtml(detail)}">${escapeHtml(truncateStatusPath(detail))}</span>` : ''}
    `;
  }

  function fitCanvasDisplaySize() {
    if (!canvasViewport || !canvas || !canvas.width || !canvas.height) {
      return;
    }
    const padding = 32;
    const maxW = Math.max(120, canvasViewport.clientWidth - padding);
    const maxH = Math.max(120, canvasViewport.clientHeight - padding);
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
    const displayW = Math.max(1, Math.round(canvas.width * scale));
    const displayH = Math.max(1, Math.round(canvas.height * scale));
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;
  }

  function syncImageListSummary() {
    const labeledCount = state.images.filter((image) => image.hasLabel).length;
    document.getElementById('taggingImageCount').textContent = `${state.images.length}장 jpg · 라벨 ${labeledCount}장`;
  }

  function updateImageListItem(index) {
    const container = document.getElementById('taggingImageList');
    const image = state.images[index];
    if (!container || !image) {
      renderImageList();
      return;
    }
    const button = container.querySelector(`.tagging-image-button[data-index="${index}"]`);
    if (!button) {
      renderImageList();
      return;
    }
    const badge = button.querySelector('.tagging-image-badge');
    if (badge) {
      badge.className = `tagging-image-badge ${image.hasLabel ? 'labeled' : 'empty'}`;
      badge.textContent = image.hasLabel ? `라벨 ${image.labelCount}개` : '라벨 없음';
    }
    syncImageListSummary();
  }

  function setCanvasExpanded(expanded) {
    canvasExpanded = expanded;
    stageCard?.classList.toggle('is-expanded', expanded);
    document.body.classList.toggle('tagging-canvas-expanded', expanded);
    expandCanvasButton?.classList.toggle('is-active', expanded);
    expandCanvasButton?.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    if (expandCanvasButton) {
      expandCanvasButton.textContent = expanded ? '기본 크기' : '크게 보기';
    }
    requestAnimationFrame(() => {
      fitCanvasDisplaySize();
      draw();
    });
  }

  function toggleCanvasExpanded() {
    setCanvasExpanded(!canvasExpanded);
  }

  function isTypingTarget(element) {
    if (!element) {
      return false;
    }
    const tagName = element.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || element.isContentEditable;
  }

  function maxClassId() {
    if (state.classes.length) {
      return Math.max(...state.classes.map((item) => item.id));
    }
    return 0;
  }

  function applyClassId(classId) {
    if (!Number.isInteger(classId) || classId < 0 || classId > maxClassId()) {
      return false;
    }
    const select = document.getElementById('taggingClassSelect');
    if (state.selectedIndex >= 0) {
      state.boxes[state.selectedIndex].classId = classId;
      if (select) {
        select.value = String(classId);
      }
      markDirty();
      renderBoxList();
      draw();
      return true;
    }
    if (select) {
      select.value = String(classId);
    }
    return true;
  }

  function parseClassShortcutKey(key) {
    if (!/^[0-9]$/.test(key)) {
      return null;
    }
    return Number(key);
  }

  function selectBoxAtCursor() {
    if (state.currentIndex < 0 || !state.hoverPoint) {
      return;
    }
    const hitIndex = findBoxAt(state.hoverPoint);
    if (hitIndex < 0) {
      return;
    }
    state.selectedIndex = hitIndex;
    document.getElementById('taggingClassSelect').value = String(state.boxes[hitIndex].classId);
    renderBoxList();
    draw();
  }

  function isPointInsideBox(point, box) {
    return point.x >= box.x
      && point.x <= box.x + box.width
      && point.y >= box.y
      && point.y <= box.y + box.height;
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function normalizeBox(box) {
    const x1 = Math.min(box.x, box.x + box.width);
    const y1 = Math.min(box.y, box.y + box.height);
    const x2 = Math.max(box.x, box.x + box.width);
    const y2 = Math.max(box.y, box.y + box.height);
    return { ...box, x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function clampBox(box) {
    const normalized = normalizeBox(box);
    normalized.x = Math.max(0, Math.min(canvas.width, normalized.x));
    normalized.y = Math.max(0, Math.min(canvas.height, normalized.y));
    normalized.width = Math.max(0, Math.min(canvas.width - normalized.x, normalized.width));
    normalized.height = Math.max(0, Math.min(canvas.height - normalized.y, normalized.height));
    return normalized;
  }

  function handlesForBox(box) {
    return {
      tl: { x: box.x, y: box.y }, tr: { x: box.x + box.width, y: box.y },
      bl: { x: box.x, y: box.y + box.height }, br: { x: box.x + box.width, y: box.y + box.height },
    };
  }

  function hitHandle(point, box) {
    const tolerance = Math.max(7, canvas.width / 150);
    for (const [name, handle] of Object.entries(handlesForBox(box))) {
      if (Math.abs(point.x - handle.x) <= tolerance && Math.abs(point.y - handle.y) <= tolerance) return name;
    }
    return null;
  }

  function findBoxAt(point) {
    for (let index = state.boxes.length - 1; index >= 0; index -= 1) {
      const box = state.boxes[index];
      if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) return index;
    }
    return -1;
  }

  function classLabel(classId) {
    const classInfo = state.classes.find((item) => item.id === Number(classId));
    return classInfo ? `${classInfo.id} - ${classInfo.name}` : `class ${classId}`;
  }

  function renderClassSelect() {
    const select = document.getElementById('taggingClassSelect');
    if (!select) {
      return;
    }
    if (!state.classes.length) {
      select.innerHTML = '<option value="0">0 - class 0</option>';
      return;
    }
    select.innerHTML = state.classes.map((item) => `<option value="${item.id}">${escapeHtml(`${item.id} - ${item.name}`)}</option>`).join('');
  }

  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (state.image.complete && state.image.naturalWidth) context.drawImage(state.image, 0, 0, canvas.width, canvas.height);
    state.boxes.forEach((box, index) => {
      const color = boxColors[Number(box.classId) % boxColors.length];
      context.save();
      context.strokeStyle = index === state.selectedIndex ? '#ffe35b' : color;
      context.lineWidth = Math.max(2, canvas.width / 500);
      context.strokeRect(box.x, box.y, box.width, box.height);
      const label = classLabel(box.classId);
      context.font = `${Math.max(14, canvas.width / 65)}px sans-serif`;
      const textWidth = context.measureText(label).width + 12;
      context.fillStyle = index === state.selectedIndex ? '#ffe35b' : color;
      context.fillRect(box.x, Math.max(0, box.y - 24), textWidth, 24);
      context.fillStyle = '#08101d';
      context.fillText(label, box.x + 6, Math.max(17, box.y - 7));
      if (index === state.selectedIndex) {
        for (const handle of Object.values(handlesForBox(box))) {
          const size = Math.max(8, canvas.width / 125);
          context.fillStyle = '#ffffff';
          context.fillRect(handle.x - size / 2, handle.y - size / 2, size, size);
          context.strokeRect(handle.x - size / 2, handle.y - size / 2, size, size);
        }
      }
      context.restore();
    });
  }

  function renderBoxList() {
    const container = document.getElementById('taggingBoxList');
    if (!state.boxes.length) {
      container.innerHTML = '<div class="muted">Bounding Box가 없습니다.</div>';
      return;
    }
    container.innerHTML = state.boxes.map((box, index) => `<div class="box-list-item ${index === state.selectedIndex ? 'active' : ''}" data-index="${index}"><span class="box-color" style="background:${boxColors[Number(box.classId) % boxColors.length]}"></span><span>Box ${index + 1} · ${escapeHtml(classLabel(box.classId))}</span><button type="button" data-delete-index="${index}">삭제</button></div>`).join('');
    container.querySelectorAll('.box-list-item').forEach((item) => item.addEventListener('click', (event) => {
      if (event.target.closest('[data-delete-index]')) return;
      state.selectedIndex = Number(item.dataset.index);
      document.getElementById('taggingClassSelect').value = String(state.boxes[state.selectedIndex].classId);
      renderBoxList(); draw();
    }));
    container.querySelectorAll('[data-delete-index]').forEach((button) => button.addEventListener('click', () => deleteBox(Number(button.dataset.deleteIndex))));
  }

  function markDirty() {
    state.dirty = true;
    setSaveStatus('dirty', '저장되지 않은 변경사항이 있습니다.');
    scheduleAutoSave();
  }

  function scheduleAutoSave() {
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = global.setTimeout(() => {
      saveCurrentLabels().catch(() => {});
    }, 900);
  }

  function deleteAllBoxes() {
    if (!state.boxes.length) {
      return;
    }
    state.boxes = [];
    state.selectedIndex = -1;
    markDirty();
    renderBoxList();
    draw();
  }

  function deleteBox(index = state.selectedIndex) {
    if (index < 0 || index >= state.boxes.length) return;
    state.boxes.splice(index, 1);
    state.selectedIndex = Math.min(state.boxes.length - 1, index);
    markDirty(); renderBoxList(); draw();
  }

  async function saveCurrentLabels(options = {}) {
    if (state.currentIndex < 0 || !state.images[state.currentIndex]) return null;
    if (!state.dirty && !options.force) return null;
    clearTimeout(state.autoSaveTimer);
    const image = state.images[state.currentIndex];
    const labels = state.boxes.map((box) => ({
      classId: Number(box.classId),
      xCenter: (box.x + box.width / 2) / canvas.width,
      yCenter: (box.y + box.height / 2) / canvas.height,
      width: box.width / canvas.width,
      height: box.height / canvas.height,
    }));
    const saveBesideImage = true;
    const result = await api.post('/api/tagging/labels', {
      imagePath: image.path,
      imageDirectory: state.imageDirectory || resolveImageDirectory(),
      saveBesideImage,
      labels,
    });
    state.dirty = false;
    image.hasLabel = labels.length > 0;
    image.labelCount = labels.length;
    image.labelPath = result.labelPath;
    setSaveStatus('saved', `${result.count}개 bbox 저장됨`, result.labelPath);
    updateImageListItem(state.currentIndex);
    return result;
  }

  async function selectImage(index) {
    if (index < 0 || index >= state.images.length) return;
    await saveCurrentLabels();
    state.currentIndex = index;
    state.selectedIndex = -1;
    state.boxes = [];
    state.dirty = false;
    const imageItem = state.images[index];
    document.querySelectorAll('.tagging-image-button').forEach((button) => button.classList.toggle('active', Number(button.dataset.index) === index));
    document.getElementById('taggingPosition').textContent = `${index + 1} / ${state.images.length}`;
    setSaveStatus('', '라벨을 불러오는 중입니다.');

    await new Promise((resolve, reject) => {
      state.image.onload = resolve;
      state.image.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${imageItem.name}`));
      state.image.src = `${imageItem.imageUrl}&t=${Date.now()}`;
    });
    canvas.width = state.image.naturalWidth;
    canvas.height = state.image.naturalHeight;
    lockCanvasViewportScroll();
    fitCanvasDisplaySize();
    const labelResult = await api.get(`/api/tagging/labels?imagePath=${encodeURIComponent(imageItem.path)}&imageDirectory=${encodeURIComponent(state.imageDirectory || resolveImageDirectory())}&saveBesideImage=1`);
    state.boxes = labelResult.labels.map((label) => ({
      classId: label.classId,
      x: (label.xCenter - label.width / 2) * canvas.width,
      y: (label.yCenter - label.height / 2) * canvas.height,
      width: label.width * canvas.width,
      height: label.height * canvas.height,
    }));
    setSaveStatus('', labelResult.labels.length
      ? `${labelResult.labels.length}개 YOLO 라벨 불러옴`
      : '라벨 없음 · bbox를 그리면 자동 저장됩니다.');
    renderBoxList(); draw();
  }

  function renderImageList() {
    const container = document.getElementById('taggingImageList');
    if (!state.images.length) {
      container.innerHTML = '<div class="muted">이미지가 없습니다.</div>';
      document.getElementById('taggingImageCount').textContent = '0장';
      return;
    }
    container.innerHTML = state.images.map((image, index) => `
      <button type="button" class="tagging-image-button ${index === state.currentIndex ? 'active' : ''}" data-index="${index}" title="${escapeHtml(image.path)}">
        <span class="tagging-image-button-title">${index + 1}. ${escapeHtml(imageDisplayName(image))}</span>
        <span class="tagging-image-badge ${image.hasLabel ? 'labeled' : 'empty'}">${image.hasLabel ? `라벨 ${image.labelCount}개` : '라벨 없음'}</span>
      </button>
    `).join('');
    container.querySelectorAll('.tagging-image-button').forEach((button) => button.addEventListener('click', () => selectImage(Number(button.dataset.index)).catch(global.MLOps.handleError)));
    syncImageListSummary();
  }

  async function loadImages(preferredIndex = 0) {
    await saveCurrentLabels();
    const imageDirectory = resolveImageDirectory();
    const result = await api.get(`/api/tagging/images?imageDirectory=${encodeURIComponent(imageDirectory)}`);
    state.images = result.images || [];
    if (!state.classesFilePath) {
      state.classes = result.classes || [];
    }
    state.imageDirectory = result.imageDirectory || imageDirectory;
    state.currentIndex = -1;
    updateFolderSummaryText();
    renderClassSelect();
    renderImageList();
    updateSummary(result.summary);
    if (state.images.length) {
      const index = Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < state.images.length
        ? preferredIndex
        : 0;
      await selectImage(index);
    } else {
      draw();
      setSaveStatus('error', '선택한 폴더에 jpg 이미지가 없습니다.');
    }
    showToast(result.summary
      ? `jpg ${result.summary.totalImages}장 · 라벨 ${result.summary.labeledImages}장`
      : `${state.images.length}장의 jpg 이미지를 불러왔습니다.`);
  }

  function updateSummary(summary) {
    const element = document.getElementById('taggingSummaryText');
    if (!element) {
      return;
    }
    const classSource = state.classesFilePath
      ? ` · 클래스 ${state.classesFilePath.split('/').pop()}${state.classesFileSource === 'local' ? ' (로컬 PC)' : ' (서버)'}`
      : '';
    if (!summary) {
      element.textContent = `클래스 ${state.classes.length}개${classSource} · 라벨 저장: 이미지와 같은 폴더`;
      return;
    }
    element.textContent = `총 jpg ${summary.totalImages}장 · 라벨 있음 ${summary.labeledImages}장 · 라벨 없음 ${summary.unlabeledImages}장 · 클래스 ${state.classes.length}개${classSource} · 저장: 이미지와 같은 폴더`;
  }

  function lockCanvasViewportScroll() {
    if (!canvasViewport) {
      return;
    }
    canvasViewport.scrollTop = 0;
    canvasViewport.scrollLeft = 0;
  }

  function canvasPointerMove(event) {
    if (state.pointerAction) {
      event.preventDefault();
      lockCanvasViewportScroll();
    }
    if (state.currentIndex >= 0) {
      state.hoverPoint = pointerPosition(event);
    }
    pointerMove(event);
  }

  function pointerDown(event) {
    if (state.currentIndex < 0) return;
    const point = pointerPosition(event);
    state.hoverPoint = point;

    if (event.button === 2) {
      event.preventDefault();
      const hitIndex = findBoxAt(point);
      if (hitIndex >= 0) {
        deleteBox(hitIndex);
      }
      return;
    }
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    lockCanvasViewportScroll();
    canvas.setPointerCapture(event.pointerId);
    if (state.selectedIndex >= 0) {
      const selectedBox = state.boxes[state.selectedIndex];
      const handle = hitHandle(point, selectedBox);
      if (handle) {
        state.pointerAction = {
          type: 'resize',
          handle,
          start: point,
          original: { ...selectedBox },
          boxIndex: state.selectedIndex,
        };
        return;
      }
      if (isPointInsideBox(point, selectedBox)) {
        state.pointerAction = {
          type: 'move',
          start: point,
          original: { ...selectedBox },
          boxIndex: state.selectedIndex,
        };
        return;
      }
    }
    const classId = Number(document.getElementById('taggingClassSelect').value);
    state.boxes.push({ classId, x: point.x, y: point.y, width: 0, height: 0 });
    state.pointerAction = { type: 'create', start: point, boxIndex: state.boxes.length - 1 };
    renderBoxList(); draw();
  }

  function activePointerBoxIndex() {
    if (!state.pointerAction || state.pointerAction.boxIndex === undefined) {
      return state.selectedIndex;
    }
    return state.pointerAction.boxIndex;
  }

  function pointerMove(event) {
    if (!state.pointerAction) return;
    const boxIndex = activePointerBoxIndex();
    if (boxIndex < 0 || boxIndex >= state.boxes.length) return;
    const point = pointerPosition(event);
    const box = state.boxes[boxIndex];
    const action = state.pointerAction;
    if (action.type === 'create') {
      Object.assign(box, clampBox({ ...box, x: action.start.x, y: action.start.y, width: point.x - action.start.x, height: point.y - action.start.y }));
    } else if (action.type === 'move') {
      box.x = Math.max(0, Math.min(canvas.width - box.width, action.original.x + point.x - action.start.x));
      box.y = Math.max(0, Math.min(canvas.height - box.height, action.original.y + point.y - action.start.y));
    } else if (action.type === 'resize') {
      const original = action.original;
      const opposite = {
        tl: { x: original.x + original.width, y: original.y + original.height },
        tr: { x: original.x, y: original.y + original.height },
        bl: { x: original.x + original.width, y: original.y },
        br: { x: original.x, y: original.y },
      }[action.handle];
      Object.assign(box, clampBox({ ...box, x: opposite.x, y: opposite.y, width: point.x - opposite.x, height: point.y - opposite.y }));
    }
    markDirty(); draw();
  }

  function pointerUp(event) {
    if (!state.pointerAction) return;
    canvas.releasePointerCapture(event.pointerId);
    const action = state.pointerAction;
    const boxIndex = activePointerBoxIndex();
    const box = boxIndex >= 0 ? state.boxes[boxIndex] : null;
    if (box && (box.width < 4 || box.height < 4)) {
      deleteBox(boxIndex);
    }
    if (action.type === 'create') {
      state.selectedIndex = -1;
    }
    state.pointerAction = null;
    renderBoxList(); draw();
  }

  function handleKeydown(event) {
    if (!document.getElementById('tagging-page').classList.contains('active')) {
      if (canvasExpanded) {
        setCanvasExpanded(false);
      }
      return;
    }
    if (isTypingTarget(document.activeElement)) {
      return;
    }
    if (event.key === 'Escape' && canvasExpanded) {
      event.preventDefault();
      setCanvasExpanded(false);
      return;
    }
    const classId = parseClassShortcutKey(event.key);
    if (classId !== null) {
      event.preventDefault();
      applyClassId(classId);
      return;
    }
    if (event.key === 'g' || event.key === 'G') {
      event.preventDefault();
      selectBoxAtCursor();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
      event.preventDefault();
      selectImage(state.currentIndex - 1).catch(global.MLOps.handleError);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
      event.preventDefault();
      selectImage(state.currentIndex + 1).catch(global.MLOps.handleError);
    }
  }

  function canvasContextMenu(event) {
    event.preventDefault();
  }

  function blockScrollWhileDrawing(event) {
    if (!state.pointerAction) {
      return;
    }
    event.preventDefault();
  }

  function getPseudoModelSource() {
    return document.querySelector('input[name="taggingPseudoModelSource"]:checked')?.value || 'runs';
  }

  function syncPseudoModelPanels() {
    const source = getPseudoModelSource();
    document.getElementById('taggingPseudoRunsPanel')?.classList.toggle('hidden', source !== 'runs');
    document.getElementById('taggingPseudoPtPanel')?.classList.toggle('hidden', source !== 'runs');
    document.getElementById('taggingPseudoBasePanel')?.classList.toggle('hidden', source !== 'base');
  }

  function renderPseudoRunFolders() {
    const select = document.getElementById('taggingPseudoRunFolderSelect');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '<option value="">Run 폴더를 선택하세요.</option>'
      + pseudoRunFolders.map((folder) => `<option value="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</option>`).join('');
    if (pseudoRunFolders.some((folder) => folder.name === previous)) {
      select.value = previous;
    }
  }

  function renderPseudoPtFiles() {
    const select = document.getElementById('taggingPseudoPtSelect');
    if (!select) return;
    const previous = select.value;
    if (!pseudoPtFiles.length) {
      select.disabled = true;
      select.innerHTML = '<option value="">Run Load 후 .pt 파일을 선택하세요.</option>';
      return;
    }
    select.disabled = false;
    select.innerHTML = '<option value="">.pt 파일을 선택하세요.</option>'
      + pseudoPtFiles.map((file) => `<option value="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)} · ${escapeHtml(file.relativePath)}</option>`).join('');
    if (pseudoPtFiles.some((file) => file.relativePath === previous)) {
      select.value = previous;
    } else if (pseudoPtFiles.some((file) => file.name === 'best.pt')) {
      select.value = pseudoPtFiles.find((file) => file.name === 'best.pt').relativePath;
    }
  }

  function renderPseudoBaseWeights() {
    const select = document.getElementById('taggingPseudoBaseWeightSelect');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = pseudoBaseWeights.length
      ? pseudoBaseWeights.map((file) => `<option value="${escapeHtml(file.relativePath || file.path)}">${escapeHtml(file.name)} · ${escapeHtml(file.relativePath || file.path)}</option>`).join('')
      : '<option value="">weights 파일이 없습니다.</option>';
    if (pseudoBaseWeights.some((file) => (file.relativePath || file.path) === previous)) {
      select.value = previous;
    }
  }

  async function loadPseudoRunFolders() {
    const result = await api.get('/api/model-management/runs/folders');
    pseudoRunFolders = result.folders || [];
    renderPseudoRunFolders();
  }

  async function loadPseudoPtFiles() {
    const folderName = document.getElementById('taggingPseudoRunFolderSelect')?.value;
    if (!folderName) {
      showToast('Run 폴더를 먼저 선택하세요.', 'error');
      return;
    }
    const button = document.getElementById('taggingPseudoLoadPtButton');
    if (button) button.disabled = true;
    try {
      const result = await api.get(`/api/model-management/runs/${encodeURIComponent(folderName)}/pt-files`);
      pseudoPtFiles = result.files || [];
      renderPseudoPtFiles();
      if (!pseudoPtFiles.length) {
        showToast(`${folderName} 폴더에 .pt 파일이 없습니다.`, 'error');
      } else {
        showToast(`.pt 파일 ${pseudoPtFiles.length}개를 불러왔습니다.`);
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadPseudoBaseWeights() {
    const result = await api.get('/api/tagging/base-weights');
    pseudoBaseWeights = result.weights || [];
    renderPseudoBaseWeights();
  }

  function resolveSelectedPseudoModelPath() {
    const source = getPseudoModelSource();
    if (source === 'base') {
      const selected = document.getElementById('taggingPseudoBaseWeightSelect')?.value;
      if (!selected) {
        throw new Error('기본 weights (.pt) 모델을 선택하세요.');
      }
      return selected;
    }
    const selected = document.getElementById('taggingPseudoPtSelect')?.value;
    if (!selected) {
      throw new Error('Run Load 후 .pt 모델을 선택하세요.');
    }
    return selected;
  }

  function buildPseudoLabelPayload(scope) {
    const imageDirectory = state.imageDirectory || resolveImageDirectory();
    if (!imageDirectory) {
      throw new Error('이미지 폴더를 먼저 선택하세요.');
    }
    if (!state.images.length && scope !== 'current') {
      throw new Error('이미지 목록을 먼저 불러오세요.');
    }
    const payload = {
      imageDirectory,
      sourcePtPath: resolveSelectedPseudoModelPath(),
      scope,
      conf: Number(document.getElementById('taggingPseudoConf')?.value || 0.25),
      iou: Number(document.getElementById('taggingPseudoIou')?.value || 0.45),
      overwrite: Boolean(document.getElementById('taggingPseudoOverwrite')?.checked),
      classNames: state.classes.map((item) => item.name),
      estimatedCount: scope === 'current' ? 1 : state.images.filter((image) => (
        scope === 'all' || !image.hasLabel
      )).length,
    };
    if (scope === 'current') {
      const current = state.images[state.currentIndex];
      if (!current) {
        throw new Error('현재 선택된 이미지가 없습니다.');
      }
      payload.imagePath = current.path;
    }
    return payload;
  }

  function setPseudoStatus(message) {
    const element = document.getElementById('taggingPseudoStatus');
    if (element) {
      element.textContent = message;
    }
  }

  async function runPseudoLabel(scope) {
    const payload = buildPseudoLabelPayload(scope);
    const buttons = [
      document.getElementById('taggingPseudoCurrentButton'),
      document.getElementById('taggingPseudoUnlabeledButton'),
      document.getElementById('taggingPseudoAllButton'),
    ].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });
    setPseudoStatus('학습 서버에서 pseudo labeling 실행 중...');
    try {
      const result = await api.post('/api/tagging/pseudo-label', payload);
      const warning = Array.isArray(result.unmappedClasses) && result.unmappedClasses.length
        ? ` · 매핑 실패 클래스: ${result.unmappedClasses.join(', ')}`
        : '';
      setPseudoStatus(
        `완료 · 처리 ${result.processedCount}장 · 건너뜀 ${result.skippedCount}장 · bbox ${result.totalBoxes}개${warning}`,
      );
      showToast(`Pseudo labeling 완료: ${result.processedCount}장, bbox ${result.totalBoxes}개`);
      const previousIndex = state.currentIndex;
      await loadImages(previousIndex >= 0 ? previousIndex : 0);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function init() {
    canvas = document.getElementById('taggingCanvas');
    context = canvas.getContext('2d');
    canvasViewport = canvas?.closest('.tagging-canvas-viewport') || null;
    stageCard = canvas?.closest('.tagging-stage-card') || null;
    expandCanvasButton = document.getElementById('taggingExpandCanvasButton');
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', canvasPointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('contextmenu', canvasContextMenu);
    canvasViewport?.addEventListener('wheel', blockScrollWhileDrawing, { passive: false });
    window.addEventListener('wheel', blockScrollWhileDrawing, { passive: false, capture: true });
    document.getElementById('taggingSelectImageFolderButton')?.addEventListener('click', () => toggleImageFolderPanel());
    document.getElementById('taggingTogglePseudoPanelButton')?.addEventListener('click', () => togglePseudoLabelPanel());
    document.getElementById('taggingApplyImagePathButton')?.addEventListener('click', () => applyImageFolderPath().catch(global.MLOps.handleError));
    document.getElementById('taggingBrowseImageFolderButton')?.addEventListener('click', () => openFolderModal());
    getImageDirectoryInput()?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyImageFolderPath().catch(global.MLOps.handleError);
      }
    });
    document.getElementById('taggingFolderModalClose')?.addEventListener('click', closeFolderModal);
    document.getElementById('taggingSelectCurrentFolderButton')?.addEventListener('click', selectCurrentFolder);
    document.getElementById('taggingFolderModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'taggingFolderModal') {
        closeFolderModal();
      }
    });
    document.getElementById('taggingLoadClassesButton')?.addEventListener('click', handleLoadClassesButtonClick);
    document.querySelectorAll('input[name="taggingClassesSource"]').forEach((input) => {
      input.addEventListener('change', syncClassesSourcePanels);
    });
    document.getElementById('taggingApplyClassesPathButton')?.addEventListener('click', () => loadClassesFromPath().catch(global.MLOps.handleError));
    document.getElementById('taggingApplyLocalClassesButton')?.addEventListener('click', () => loadClassesFromLocalFile().catch(global.MLOps.handleError));
    document.getElementById('taggingClassesLocalFileInput')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      const nameInput = document.getElementById('taggingClassesLocalFileName');
      if (nameInput) {
        nameInput.value = file ? file.name : '';
      }
    });
    document.getElementById('taggingBrowseClassesButton')?.addEventListener('click', openClassFileModal);
    getClassesFilePathInput()?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadClassesFromPath().catch(global.MLOps.handleError);
      }
    });
    document.getElementById('taggingClassFileModalClose')?.addEventListener('click', closeClassFileModal);
    document.getElementById('taggingClassFileModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'taggingClassFileModal') {
        closeClassFileModal();
      }
    });
    document.getElementById('taggingPreviousButton')?.addEventListener('click', () => selectImage(state.currentIndex - 1).catch(global.MLOps.handleError));
    document.getElementById('taggingNextButton')?.addEventListener('click', () => selectImage(state.currentIndex + 1).catch(global.MLOps.handleError));
    expandCanvasButton?.addEventListener('click', toggleCanvasExpanded);
    window.addEventListener('resize', () => {
      if (document.getElementById('tagging-page')?.classList.contains('active')) {
        fitCanvasDisplaySize();
      }
    });
    document.getElementById('taggingSaveButton')?.addEventListener('click', () => saveCurrentLabels({ force: true }).then(() => showToast('이미지와 같은 폴더에 저장했습니다.')).catch(global.MLOps.handleError));
    document.getElementById('taggingDeleteAllButton')?.addEventListener('click', () => deleteAllBoxes());
    document.querySelectorAll('input[name="taggingPseudoModelSource"]').forEach((input) => {
      input.addEventListener('change', syncPseudoModelPanels);
    });
    document.getElementById('taggingPseudoLoadPtButton')?.addEventListener('click', () => loadPseudoPtFiles().catch(global.MLOps.handleError));
    document.getElementById('taggingPseudoRunFolderSelect')?.addEventListener('change', () => {
      pseudoPtFiles = [];
      renderPseudoPtFiles();
    });
    document.getElementById('taggingPseudoCurrentButton')?.addEventListener('click', () => runPseudoLabel('current').catch(global.MLOps.handleError));
    document.getElementById('taggingPseudoUnlabeledButton')?.addEventListener('click', () => runPseudoLabel('unlabeled').catch(global.MLOps.handleError));
    document.getElementById('taggingPseudoAllButton')?.addEventListener('click', () => runPseudoLabel('all').catch(global.MLOps.handleError));
    document.getElementById('taggingClassSelect')?.addEventListener('change', (event) => {
      if (state.selectedIndex >= 0) {
        state.boxes[state.selectedIndex].classId = Number(event.target.value); markDirty(); renderBoxList(); draw();
      }
    });
    window.addEventListener('keydown', handleKeydown);
    syncClassesSourcePanels();
    syncPseudoModelPanels();
    draw();
  }

  function configure(clientConfig) {
    const dataRoot = clientConfig?.dataRoot || DEFAULT_DATA_ROOT;
    const imageInput = getImageDirectoryInput();
    if (imageInput && !imageInput.value.trim()) {
      imageInput.value = clientConfig?.detectorImagesRoot || `${dataRoot}/detector/Images`;
    }
    if (state.classesFilePath && state.classesFileSource === 'server') {
      syncClassesFilePathInput(state.classesFilePath);
    }
    updateFolderSummaryText();
    syncClassesSourcePanels();
  }

  global.MLOps.taggingController = {
    init,
    configure,
    loadImages,
    loadPseudoRunFolders,
    loadPseudoBaseWeights,
  };
})(window);