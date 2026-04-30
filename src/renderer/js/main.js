const api = (() => {
  if (window.quickNoteAPI) return window.quickNoteAPI;
  if (window.api) return window.api;
  try {
    const { ipcRenderer } = require('electron');
    const path = require('path');
    return {
      invoke(channel, payload) {
        return ipcRenderer.invoke(channel, payload);
      },
      on(channel, callback) {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
      },
      async resolveAssetUrl(relativePath) {
        const documentsPath = await ipcRenderer.invoke('app:get-path', 'documents');
        const fullPath = path.join(documentsPath, 'QuickNote', relativePath);
        return `file://${fullPath.replace(/\\/g, '/')}`;
      }
    };
  } catch (_error) {
    return {
      invoke() {
        throw new Error('QuickNote bridge unavailable');
      },
      on() {
        return () => {};
      },
      async resolveAssetUrl() {
        return '';
      }
    };
  }
})();

function stripHtml(input) {
  return String(input || '').replace(/<[^>]*>/g, '');
}

async function resolveAssetUrl(relativePath) {
  return api.resolveAssetUrl(relativePath);
}

const collectionList = document.getElementById('collectionList');
const notesGrid = document.getElementById('notesGrid');
const searchInput = document.getElementById('searchInput');
const sortBtn = document.getElementById('sortBtn');
const sortMenu = document.getElementById('sortMenu');
const selectBtn = document.getElementById('selectBtn');
const minimizeBtn = document.getElementById('minimizeBtn');
const openSettings = document.getElementById('openSettings');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const notesScroll = document.getElementById('notesScroll');
const scrollIndicator = document.getElementById('scrollIndicator');
const addCollectionBtn = document.getElementById('addCollectionBtn');
const noteCount = document.getElementById('noteCount');
const notesArea = document.getElementById('notesArea');
const collectionInputWrap = document.getElementById('collectionInputWrap');
const collectionContextMenu = document.getElementById('collectionContextMenu');
const renameCollectionBtn = document.getElementById('renameCollectionBtn');
const deleteCollectionBtn = document.getElementById('deleteCollectionBtn');
const collectionDeleteModal = document.getElementById('collectionDeleteModal');
const cancelCollectionDeleteBtn = document.getElementById('cancelCollectionDeleteBtn');
const confirmCollectionDeleteBtn = document.getElementById('confirmCollectionDeleteBtn');
const selectionBar = document.getElementById('selectionBar');
const selectionCount = document.getElementById('selectionCount');
const moveCollectionSelect = document.getElementById('moveCollectionSelect');
const moveSelectionBtn = document.getElementById('moveSelectionBtn');
const exportSelectionBtn = document.getElementById('exportSelectionBtn');
const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
const deleteSelectionBtn = document.getElementById('deleteSelectionBtn');
const settingsPanel = document.getElementById('settingsPanel');
const dataPathValue = document.getElementById('dataPathValue');
const openDataFolderBtn = document.getElementById('openDataFolderBtn');
const exportAllBtn = document.getElementById('exportAllBtn');
const backupDataBtn = document.getElementById('backupDataBtn');
const shortcutInput = document.getElementById('shortcutInput');
const saveShortcutBtn = document.getElementById('saveShortcutBtn');
const themeToggle = document.getElementById('themeToggle');
const rememberModeToggle = document.getElementById('rememberModeToggle');
const settingsStatus = document.getElementById('settingsStatus');
const buildStamp = document.getElementById('buildStamp');
const sidebar = document.querySelector('.sidebar');
const sidebarCollections = document.querySelector('.sidebar-collections');
const collectionScroll = document.getElementById('collectionScroll');
const sidebarFooter = document.querySelector('.sidebar-footer');
const logo = document.querySelector('.logo');

let currentCollectionId = 'all';
let sortMode = 'updatedAt';
let collections = [];
let notes = [];
let draggedId = null;
let configCache = null;
let selectionMode = false;
let selectedNoteIds = new Set();
let settingsOpen = false;
let contextCollectionId = null;
let pendingDeleteCollectionId = null;

function setBuildStamp(message, isError = false) {
  if (!buildStamp) return;
  buildStamp.textContent = message;
  buildStamp.dataset.state = isError ? 'error' : 'ready';
}

setBuildStamp('renderer loaded');

async function loadConfig() {
  try {
    configCache = await api.invoke('data:get-config');
  } catch (_error) {
    configCache = {
      shortcut: 'Ctrl+Shift+N',
      sortMode: 'updatedAt',
      lastCollectionId: 'all',
      theme: 'light',
      rememberState: true,
      dataPath: ''
    };
  }
  sortMode = configCache.sortMode || 'updatedAt';
  currentCollectionId = configCache.lastCollectionId || 'all';
}

async function saveConfig(patch = {}) {
  const next = {
    ...(configCache || {}),
    ...patch,
    sortMode,
    lastCollectionId: currentCollectionId
  };
  configCache = await api.invoke('data:save-config', next);
  hydrateSettingsPanel();
  return configCache;
}

async function loadData() {
  try {
    const data = await api.invoke('data:search', {
      collectionId: currentCollectionId,
      search: searchInput?.value || '',
      sortMode
    });
    collections = data.collections || [];
    notes = data.notes || [];
  } catch (_error) {
    collections = [];
    notes = [];
  }
  if (sortMode === 'custom' && !selectionMode) {
    await ensureCustomOrder();
  }
  renderCollections();
  renderNotes();
  hydrateMoveCollectionSelect();
  requestAnimationFrame(updateCollectionOverflowState);
}

function updateCollectionOverflowState() {
  if (!sidebar || !sidebarCollections || !collectionScroll || !addCollectionBtn || !sidebarFooter || !logo) return;
  sidebarCollections.classList.remove('is-overflowing');
  const availableHeight = sidebar.clientHeight
    - logo.offsetHeight
    - parseFloat(getComputedStyle(sidebarCollections).marginTop || '0')
    - sidebarFooter.offsetHeight;
  const contentHeight = collectionScroll.scrollHeight + addCollectionBtn.offsetHeight + 8;
  sidebarCollections.classList.toggle('is-overflowing', contentHeight > availableHeight);
}

function renderCollections() {
  collectionList.innerHTML = '';

  const allItem = document.createElement('div');
  allItem.className = `collection-item ${currentCollectionId === 'all' ? 'active' : ''}`;
  allItem.innerHTML = `
    <span class="collection-label">全部笔记</span>
    ${currentCollectionId === 'all' ? '<span class="collection-dot"></span>' : ''}
  `;
  allItem.addEventListener('click', async () => {
    currentCollectionId = 'all';
    if (configCache?.rememberState !== false) {
      await saveConfig();
    }
    loadData();
  });
  collectionList.appendChild(allItem);

  collections.forEach(col => {
    const item = document.createElement('div');
    item.className = `collection-item ${currentCollectionId === col.id ? 'active' : ''}`;
    item.dataset.collectionId = col.id;
    item.innerHTML = `
      <span class="collection-label">${escapeHtml(col.name)}</span>
      ${currentCollectionId === col.id ? '<span class="collection-dot"></span>' : ''}
    `;
    item.addEventListener('click', async () => {
      currentCollectionId = col.id;
      if (configCache?.rememberState !== false) {
        await saveConfig();
      }
      loadData();
    });
    item.addEventListener('contextmenu', event => {
      event.preventDefault();
      showCollectionContextMenu(col, event.currentTarget);
    });
    collectionList.appendChild(item);
  });
}

function showCollectionContextMenu(collection, target) {
  contextCollectionId = collection.id;
  const rect = target.getBoundingClientRect();
  const shellRect = document.querySelector('.main-shell').getBoundingClientRect();
  collectionContextMenu.style.left = `${rect.right - shellRect.left + 8}px`;
  collectionContextMenu.style.top = `${rect.top - shellRect.top}px`;
  collectionContextMenu.classList.remove('hidden');
  deleteCollectionBtn.disabled = !!collection.isDefault;
}

function hideCollectionContextMenu() {
  contextCollectionId = null;
  collectionContextMenu.classList.add('hidden');
}

async function beginCollectionRename(collectionId) {
  const collection = collections.find(item => item.id === collectionId);
  if (!collection) return;
  const item = collectionList.querySelector(`[data-collection-id="${collectionId}"]`);
  if (!item) return;
  hideCollectionContextMenu();
  const input = document.createElement('input');
  input.className = 'collection-input';
  input.value = collection.name;
  item.innerHTML = '';
  item.appendChild(input);
  input.focus();
  input.select();

  const finish = async (shouldSave) => {
    const nextName = input.value.trim();
    if (shouldSave && nextName && nextName !== collection.name) {
      await api.invoke('data:rename-collection', { collectionId, name: nextName });
    }
    loadData();
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => {
    finish(true);
  });
}

async function handleDeleteCollection() {
  const collectionId = contextCollectionId;
  const collection = collections.find(item => item.id === collectionId);
  hideCollectionContextMenu();
  if (!collection || collection.isDefault) return;
  pendingDeleteCollectionId = collectionId;
  collectionDeleteModal.classList.remove('hidden');
}

function closeDeleteCollectionModal() {
  pendingDeleteCollectionId = null;
  collectionDeleteModal.classList.add('hidden');
}

async function confirmDeleteCollection() {
  const collectionId = pendingDeleteCollectionId;
  pendingDeleteCollectionId = null;
  collectionDeleteModal.classList.add('hidden');
  if (!collectionId) return;
  const result = await api.invoke('data:delete-collection', collectionId);
  if (!result) return;
  if (currentCollectionId === collectionId) {
    currentCollectionId = getDefaultCollection()?.id || 'all';
  }
  if (configCache?.rememberState !== false) {
    await saveConfig({ lastCollectionId: currentCollectionId });
  }
  loadData();
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightText(text, term) {
  if (!term) return escapeHtml(text);
  const safe = escapeHtml(text);
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedTerm, 'gi');
  return safe.replace(regex, match => `<span class="highlight">${match}</span>`);
}

async function ensureCustomOrder() {
  const needsOrder = notes.some(note => typeof note.order !== 'number');
  if (!needsOrder) return;
  const orderList = notes.map((note, index) => ({ id: note.id, order: index }));
  await api.invoke('data:update-orders', orderList);
}

function createTagChip(text, palette) {
  const chip = document.createElement('span');
  chip.className = 'note-tag-chip';
  chip.textContent = text;
  chip.style.background = palette.background;
  chip.style.color = palette.color;
  return chip;
}

function getDefaultCollection() {
  return collections.find(collection => collection.isDefault) || collections[0] || null;
}

function getTagColorClass(tag) {
  const palettes = [
    { background: '#dbeeff', color: '#2a74d7' },
    { background: '#ffd8e5', color: '#d94d78' },
    { background: '#ddf6d8', color: '#4f9550' },
    { background: '#fff0bf', color: '#b78416' },
    { background: '#eadcff', color: '#7b51d1' },
    { background: '#dff6f2', color: '#2a8f85' },
    { background: '#ffe4cf', color: '#cf6a2e' },
    { background: '#dde8ff', color: '#4769cc' }
  ];
  const hash = Array.from(String(tag || '')).reduce((sum, char, index) => sum + (char.charCodeAt(0) * (index + 1)), 0);
  return palettes[hash % palettes.length];
}

function renderNotes() {
  notesGrid.innerHTML = '';
  noteCount.textContent = notes.length.toString();
  notesArea.classList.toggle('empty', notes.length === 0);

  const newCard = document.createElement('div');
  newCard.className = 'note-card new-note';
  newCard.dataset.noteAction = 'new';
  newCard.innerHTML = '<img src="./assets/icons/新增笔记1.svg" alt="新增笔记" class="new-note-icon" /><span>NEW NOTE</span>';
  notesGrid.appendChild(newCard);

  notes.forEach(note => {
    const imageAttachment = (note.attachments || []).find(att => att.type === 'image');
    const card = document.createElement('div');
    const cardTypeClass = imageAttachment ? 'with-image' : 'text-card';
    card.className = `note-card ${cardTypeClass} ${sortMode === 'custom' && !selectionMode ? 'draggable' : ''}`;
    card.dataset.noteId = note.id;

    if (selectionMode) {
      card.classList.add('selectable');
      if (selectedNoteIds.has(note.id)) {
        card.classList.add('selected');
      }
    }

    if (sortMode === 'custom' && !selectionMode) {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', handleDragStart);
      card.addEventListener('dragend', handleDragEnd);
      card.addEventListener('dragover', handleDragOver);
      card.addEventListener('drop', handleDrop);
      card.addEventListener('dragleave', handleDragLeave);
    }

    if (imageAttachment) {
      const img = document.createElement('img');
      img.className = 'note-thumb';
      resolveAssetUrl(imageAttachment.path).then(url => {
        img.src = url;
      });
      card.appendChild(img);
    }

    const title = document.createElement('div');
    title.className = 'note-title';
    title.innerHTML = highlightText(note.title || '未命名', searchInput.value.trim());
    card.appendChild(title);

    const preview = document.createElement('div');
    preview.className = 'note-preview';
    const previewText = stripHtml(note.content || '').replace(/\s+/g, ' ').trim();
    preview.innerHTML = highlightText(previewText, searchInput.value.trim());
    card.appendChild(preview);

    const meta = document.createElement('div');
    meta.className = 'note-meta';

    const tagWrap = document.createElement('div');
    tagWrap.className = 'note-meta-tags';
    const firstTags = (note.tags || []).slice(0, 3);
    firstTags.forEach(tag => {
      tagWrap.appendChild(createTagChip(tag, getTagColorClass(tag)));
    });

    const counts = document.createElement('div');
    counts.className = 'note-meta-counts';
    const imageCount = (note.attachments || []).filter(att => att.type === 'image').length;
    const audioCount = (note.attachments || []).filter(att => att.type === 'audio').length;
    counts.textContent = imageCount > 0 ? `图片 ${imageCount}  录音 ${audioCount}` : `录音 ${audioCount}`;

    meta.appendChild(tagWrap);
    meta.appendChild(counts);
    card.appendChild(meta);

    card.addEventListener('click', event => {
      if (selectionMode) return;
      event.stopPropagation();
      api.invoke('app:show-note', note.id);
    });

    notesGrid.appendChild(card);
  });

  updateSelectionUi();
  renderSortMenu();
  updateScrollIndicator();
}

function handleNotesGridClick(event) {
  const newNoteCard = event.target.closest('[data-note-action="new"]');
  if (newNoteCard) {
    createNewNoteAndOpen();
    return;
  }

  const noteCard = event.target.closest('[data-note-id]');
  if (!noteCard) return;
  const noteId = noteCard.dataset.noteId;
  if (!noteId) return;
  if (selectionMode) {
    toggleNoteSelection(noteId);
    return;
  }
  api.invoke('app:show-note', noteId);
}

function renderSortMenu() {
  Array.from(sortMenu.querySelectorAll('[data-sort-mode]')).forEach(button => {
    button.classList.toggle('active', button.dataset.sortMode === sortMode);
  });
}

function hydrateMoveCollectionSelect() {
  if (!moveCollectionSelect) return;
  moveCollectionSelect.innerHTML = '<option value="">移动到...</option>';
  collections.forEach(collection => {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.name;
    moveCollectionSelect.appendChild(option);
  });
}

function handleDragStart(event) {
  draggedId = event.currentTarget.dataset.noteId;
  event.currentTarget.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  draggedId = null;
}

function handleDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

async function handleDrop(event) {
  event.preventDefault();
  const target = event.currentTarget;
  target.classList.remove('drag-over');
  if (!draggedId || draggedId === target.dataset.noteId) return;
  const draggedEl = notesGrid.querySelector(`[data-note-id="${draggedId}"]`);
  if (!draggedEl) return;
  const rect = target.getBoundingClientRect();
  const isBefore = event.clientY < rect.top + rect.height / 2;
  notesGrid.insertBefore(draggedEl, isBefore ? target : target.nextSibling);
  await saveCustomOrder();
}

async function saveCustomOrder() {
  const orderList = Array.from(notesGrid.querySelectorAll('[data-note-id]')).map((el, index) => ({
    id: el.dataset.noteId,
    order: index
  }));
  await api.invoke('data:update-orders', orderList);
  const orderMap = new Map(orderList.map(item => [item.id, item.order]));
  notes = notes.map(note => ({ ...note, order: orderMap.get(note.id) }));
}

function updateScrollIndicator() {
  const scrollTop = notesScroll.scrollTop;
  const scrollHeight = notesScroll.scrollHeight - notesScroll.clientHeight;
  if (scrollHeight <= 0) {
    scrollIndicator.classList.add('hidden');
    return;
  }
  const ratio = scrollTop / scrollHeight;
  const maxOffset = notesScroll.clientHeight - 140;
  scrollIndicator.style.transform = `translateY(${Math.max(0, ratio * maxOffset)}px)`;
  scrollIndicator.classList.remove('hidden');
}

function toggleSelectionMode(force) {
  selectionMode = typeof force === 'boolean' ? force : !selectionMode;
  if (!selectionMode) {
    selectedNoteIds.clear();
  }
  selectBtn.classList.toggle('active', selectionMode);
  updateSelectionUi();
  renderNotes();
}

function toggleNoteSelection(noteId) {
  if (selectedNoteIds.has(noteId)) {
    selectedNoteIds.delete(noteId);
  } else {
    selectedNoteIds.add(noteId);
  }
  updateSelectionUi();
  renderNotes();
}

function updateSelectionUi() {
  selectionBar.classList.toggle('hidden', !selectionMode);
  selectionCount.textContent = `已选择 ${selectedNoteIds.size} 条`;
  deleteSelectionBtn.disabled = selectedNoteIds.size === 0;
  moveSelectionBtn.disabled = selectedNoteIds.size === 0;
  exportSelectionBtn.disabled = selectedNoteIds.size === 0;
}

async function deleteSelectedNotes() {
  if (selectedNoteIds.size === 0) return;
  const confirmed = window.confirm(`确认删除已选择的 ${selectedNoteIds.size} 条笔记吗？`);
  if (!confirmed) return;
  await api.invoke('data:delete-notes', Array.from(selectedNoteIds));
  selectedNoteIds.clear();
  toggleSelectionMode(false);
}

async function moveSelectedNotes() {
  if (selectedNoteIds.size === 0) return;
  const targetCollectionId = moveCollectionSelect.value;
  if (!targetCollectionId) {
    setSettingsStatus('请先选择一个目标收藏夹');
    return;
  }
  await api.invoke('data:move-notes', {
    noteIds: Array.from(selectedNoteIds),
    collectionId: targetCollectionId
  });
  selectedNoteIds.clear();
  toggleSelectionMode(false);
}

async function exportSelectedNotes(noteIds) {
  if (!noteIds.length) return;
  const filePath = await api.invoke('data:export-notes', noteIds);
  if (filePath) {
    setSettingsStatus(`已导出：${filePath}`);
  }
}

function toggleSettings(force) {
  settingsOpen = typeof force === 'boolean' ? force : !settingsOpen;
  settingsPanel.classList.toggle('hidden', !settingsOpen);
  openSettings.classList.toggle('active', settingsOpen);
}

function hydrateSettingsPanel() {
  if (!configCache) return;
  dataPathValue.textContent = configCache.dataPath || '未找到存储路径';
  shortcutInput.value = configCache.shortcut || 'Ctrl+Shift+N';
  themeToggle.checked = configCache.theme === 'soft';
  rememberModeToggle.checked = configCache.rememberState !== false;
}

function setSettingsStatus(message) {
  settingsStatus.textContent = message;
}

async function saveSettings() {
  const shortcut = shortcutInput.value.trim() || 'Ctrl+Shift+N';
  const theme = themeToggle.checked ? 'soft' : 'light';
  const rememberState = rememberModeToggle.checked;
  await saveConfig({ shortcut, theme, rememberState });
  setSettingsStatus('设置已保存');
}

async function createNewNoteAndOpen() {
  try {
    setBuildStamp('new note: click');
    let collectionId = currentCollectionId;
    if (collectionId === 'all') {
      collectionId = configCache?.lastCollectionId || collections[0]?.id;
    }
    if (collectionId === 'all' || !collections.some(item => item.id === collectionId)) {
      collectionId = collections[0]?.id || '';
    }
    if (!collectionId) {
      setBuildStamp('new note: creating default collection');
      const fallbackCollection = await api.invoke('data:create-collection', { name: '未归档' });
      collectionId = fallbackCollection.id;
      currentCollectionId = collectionId;
      await saveConfig({ lastCollectionId: collectionId });
      await loadData();
    }
    if (!collectionId) {
      setBuildStamp('new note: no collection', true);
      return;
    }
    const result = await api.invoke('app:show-note', { draft: true, collectionId, mode: 'edit' });
    setBuildStamp(result ? 'new note: opened' : 'new note: no response', !result);
  } catch (error) {
    setBuildStamp(`new note error: ${error.message}`, true);
  }
}

function showCollectionInput() {
  if (collectionInputWrap.querySelector('input')) {
    collectionInputWrap.querySelector('input').focus();
    return;
  }
  const input = document.createElement('input');
  input.className = 'collection-input';
  input.placeholder = '收藏夹名';
  collectionInputWrap.appendChild(input);
  input.focus();
  requestAnimationFrame(updateCollectionOverflowState);

  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    if (!name) {
      collectionInputWrap.innerHTML = '';
      requestAnimationFrame(updateCollectionOverflowState);
      return;
    }
    const collection = await api.invoke('data:create-collection', { name });
    currentCollectionId = collection.id;
    if (configCache?.rememberState !== false) {
      await saveConfig();
    }
    collectionInputWrap.innerHTML = '';
    loadData();
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') finish();
    if (event.key === 'Escape') {
      collectionInputWrap.innerHTML = '';
      requestAnimationFrame(updateCollectionOverflowState);
    }
  });
  input.addEventListener('blur', () => {
    if (!input.value.trim()) {
      collectionInputWrap.innerHTML = '';
      requestAnimationFrame(updateCollectionOverflowState);
      return;
    }
    finish();
  });
}

searchInput?.addEventListener('input', () => loadData());

sortBtn?.addEventListener('click', event => {
  event.stopPropagation();
  sortMenu.classList.toggle('hidden');
});

[sortBtn, selectBtn, minimizeBtn].forEach(button => {
  button?.addEventListener('mousedown', event => {
    event.stopPropagation();
  });
});

sortMenu?.addEventListener('click', async event => {
  const button = event.target.closest('[data-sort-mode]');
  if (!button) return;
  sortMode = button.dataset.sortMode;
  sortMenu.classList.add('hidden');
  if (configCache?.rememberState !== false) {
    await saveConfig();
  }
  loadData();
});

selectBtn?.addEventListener('click', () => {
  toggleSelectionMode();
});

openSettings?.addEventListener('click', event => {
  event.stopPropagation();
  toggleSettings();
});

closeSettingsBtn?.addEventListener('click', () => {
  toggleSettings(false);
});

openDataFolderBtn?.addEventListener('click', async () => {
  const result = await api.invoke('app:open-data-path');
  setSettingsStatus(result ? '已打开存储文件夹' : '打开失败，请稍后重试');
});

exportAllBtn?.addEventListener('click', async () => {
  await exportSelectedNotes([]);
});

backupDataBtn?.addEventListener('click', async () => {
  const backupPath = await api.invoke('data:create-backup');
  setSettingsStatus(backupPath ? `备份已创建：${backupPath}` : '备份失败');
});

saveShortcutBtn?.addEventListener('click', () => {
  saveSettings();
});

addCollectionBtn?.addEventListener('click', () => {
  showCollectionInput();
});

renameCollectionBtn?.addEventListener('click', () => {
  if (contextCollectionId) {
    beginCollectionRename(contextCollectionId);
  }
});

deleteCollectionBtn?.addEventListener('click', () => {
  handleDeleteCollection();
});

cancelCollectionDeleteBtn?.addEventListener('click', () => {
  closeDeleteCollectionModal();
});

confirmCollectionDeleteBtn?.addEventListener('click', () => {
  confirmDeleteCollection();
});

moveSelectionBtn?.addEventListener('click', () => {
  moveSelectedNotes();
});

exportSelectionBtn?.addEventListener('click', () => {
  exportSelectedNotes(Array.from(selectedNoteIds));
});

cancelSelectionBtn?.addEventListener('click', () => {
  toggleSelectionMode(false);
});

deleteSelectionBtn?.addEventListener('click', () => {
  deleteSelectedNotes();
});

minimizeBtn?.addEventListener('click', async event => {
  event.preventDefault();
  event.stopPropagation();
  try {
    setBuildStamp('minimize: click');
    const result = await api.invoke('app:minimize-main');
    setBuildStamp(result === false ? 'minimize: no response' : 'minimize: sent');
  } catch (error) {
    setBuildStamp(`minimize error: ${error.message}`, true);
  }
});

notesScroll?.addEventListener('scroll', updateScrollIndicator);
notesGrid?.addEventListener('click', handleNotesGridClick);
window.addEventListener('resize', updateCollectionOverflowState);

document.addEventListener('click', event => {
  if (!sortMenu.classList.contains('hidden') && !sortMenu.contains(event.target) && event.target !== sortBtn && !sortBtn.contains(event.target)) {
    sortMenu.classList.add('hidden');
  }
  if (!collectionContextMenu.classList.contains('hidden') && !collectionContextMenu.contains(event.target)) {
    hideCollectionContextMenu();
  }
  if (!collectionDeleteModal.classList.contains('hidden') && event.target === collectionDeleteModal) {
    closeDeleteCollectionModal();
  }
});

api.on('data:updated', async () => {
  await loadConfig();
  await loadData();
});

async function init() {
  try {
    setBuildStamp('init: loading');
    await loadConfig();
    hydrateSettingsPanel();
    await loadData();
    renderSortMenu();
    updateScrollIndicator();
    setBuildStamp(`ready ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setBuildStamp(`init error: ${error.message}`, true);
  }
}

init();
