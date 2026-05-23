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

function htmlToPlainText(input) {
  return String(input || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<(div|p)(\s[^>]*)?>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, '');
}

async function resolveAssetUrl(relativePath) {
  return api.resolveAssetUrl(relativePath);
}

const collectionList = document.getElementById('collectionList');
const notesGrid = document.getElementById('notesGrid');
const searchInput = document.getElementById('searchInput');
const searchPill = document.querySelector('.search-pill');
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
const noteContextMenu = document.getElementById('noteContextMenu');
const renameCollectionBtn = document.getElementById('renameCollectionBtn');
const deleteCollectionBtn = document.getElementById('deleteCollectionBtn');
const pinNoteCardBtn = document.getElementById('pinNoteCardBtn');
const exportNoteImageBtn = document.getElementById('exportNoteImageBtn');
const deleteNoteCardBtn = document.getElementById('deleteNoteCardBtn');
const collectionDeleteModal = document.getElementById('collectionDeleteModal');
const cancelCollectionDeleteBtn = document.getElementById('cancelCollectionDeleteBtn');
const confirmCollectionDeleteBtn = document.getElementById('confirmCollectionDeleteBtn');
const selectionBar = document.getElementById('selectionBar');
const selectionCount = document.getElementById('selectionCount');
const selectAllBtn = document.getElementById('selectAllBtn');
const moveCollectionSelect = document.getElementById('moveCollectionSelect');
const moveSelectionBtn = document.getElementById('moveSelectionBtn');
const exportSelectionBtn = document.getElementById('exportSelectionBtn');
const mergeSelectionBtn = document.getElementById('mergeSelectionBtn');
const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
const deleteSelectionBtn = document.getElementById('deleteSelectionBtn');
const settingsPanel = document.getElementById('settingsPanel');
const dataPathValue = document.getElementById('dataPathValue');
const backupIntervalInput = document.getElementById('backupIntervalInput');
const saveBackupIntervalBtn = document.getElementById('saveBackupIntervalBtn');
const openDataFolderBtn = document.getElementById('openDataFolderBtn');
const backupDataBtn = document.getElementById('backupDataBtn');
const importBackupBtn = document.getElementById('importBackupBtn');
const shortcutInput = document.getElementById('shortcutInput');
const saveShortcutBtn = document.getElementById('saveShortcutBtn');
const rememberModeToggle = document.getElementById('rememberModeToggle');
const clipboardToggle = document.getElementById('clipboardToggle');
const openPrivateCollectionBtn = document.getElementById('openPrivateCollectionBtn');
const settingsStatus = document.getElementById('settingsStatus');
const buildStamp = document.getElementById('buildStamp');
const sidebar = document.querySelector('.sidebar');
const sidebarCollections = document.querySelector('.sidebar-collections');
const collectionScroll = document.getElementById('collectionScroll');
const sidebarFooter = document.querySelector('.sidebar-footer');
const logo = document.querySelector('.logo');
const privateCollectionGate = document.getElementById('privateCollectionGate');
const privateCollectionTitle = document.getElementById('privateCollectionTitle');
const privateCollectionCopy = document.getElementById('privateCollectionCopy');
const privatePasswordLabel = document.getElementById('privatePasswordLabel');
const privatePasswordInput = document.getElementById('privatePasswordInput');
const privatePasswordConfirmField = document.getElementById('privatePasswordConfirmField');
const privatePasswordConfirmInput = document.getElementById('privatePasswordConfirmInput');
const privatePasswordToggle = document.getElementById('privatePasswordToggle');
const privatePasswordToggleIcon = document.getElementById('privatePasswordToggleIcon');
const privateCollectionSubmit = document.getElementById('privateCollectionSubmit');
const privateCollectionStatus = document.getElementById('privateCollectionStatus');
const mainEdgeZones = Array.from(document.querySelectorAll('[data-expand-edge]'));

let currentCollectionId = 'all';
let sortMode = 'updatedAt';
let collections = [];
let notes = [];
let draggedId = null;
let suppressCardClickUntil = 0;
let configCache = null;
let selectionMode = false;
let selectedNoteIds = new Set();
let settingsOpen = false;
let contextCollectionId = null;
let pendingDeleteCollectionId = null;
let contextNoteId = null;
let contextNotePinned = false;
let privateCollectionId = '';
let privateCollectionEnabled = false;
let privateCollectionHasPassword = false;
let privateCollectionUnlocked = false;
let privatePasswordVisible = false;
let forcedCollectionId = null;
let privateCollectionOpening = false;
let draggedCollectionId = null;
const calendarCardMonthState = new Map();
let plannerCalendarIconUrl = './assets/icons/planner-calendar.svg';
const calendarCardTodayLabelState = new Map();
const calendarTodayLabelTimers = new Map();
let activeCalendarDateKey = '';
const calendarCardMonthPickerYearState = new Map();
let activeCalendarMonthPickerCollectionId = '';

function setBuildStamp(message, isError = false) {
  if (!buildStamp) return;
  buildStamp.textContent = message;
  buildStamp.dataset.state = isError ? 'error' : 'ready';
}

setBuildStamp('renderer loaded');

function isPrivateCollectionSelected() {
  return !!privateCollectionId && currentCollectionId === privateCollectionId;
}

function isPrivateCollectionLocked() {
  return isPrivateCollectionSelected() && !privateCollectionUnlocked;
}

function setPrivateCollectionStatus(message, state = '') {
  if (!privateCollectionStatus) return;
  privateCollectionStatus.textContent = message;
  if (state) {
    privateCollectionStatus.dataset.state = state;
  } else {
    delete privateCollectionStatus.dataset.state;
  }
}

function syncPrivatePasswordToggleIcon() {
  if (!privatePasswordToggleIcon) return;
  privatePasswordToggleIcon.src = privatePasswordVisible
    ? './assets/icons/eye-open.png'
    : './assets/icons/eye-closed.png';
}

async function loadPrivateCollectionState() {
  try {
    const state = await api.invoke('data:get-private-state');
    privateCollectionId = state?.collectionId || '';
    privateCollectionEnabled = !!state?.enabled;
    privateCollectionHasPassword = !!state?.hasPassword;
  } catch (_error) {
    privateCollectionId = '';
    privateCollectionEnabled = false;
    privateCollectionHasPassword = false;
  }
  if (!isPrivateCollectionSelected()) {
    privateCollectionUnlocked = false;
  }
}

function updatePrivateCollectionGate() {
  const locked = isPrivateCollectionLocked();
  notesArea?.classList.toggle('private-locked', locked);
  privateCollectionGate?.classList.toggle('hidden', !locked);
  if (!locked) {
    privatePasswordInput.value = '';
    privatePasswordConfirmInput.value = '';
    setPrivateCollectionStatus('');
    privatePasswordVisible = false;
    privatePasswordInput.type = 'password';
    privatePasswordConfirmInput.type = 'password';
    syncPrivatePasswordToggleIcon();
    return;
  }

  privateCollectionTitle.textContent = privateCollectionHasPassword ? '进入隐私收藏夹' : '设置隐私收藏夹密码';
  privateCollectionCopy.textContent = privateCollectionHasPassword
    ? '请输入密码后查看隐私收藏夹内容。'
    : '首次进入需要先设置密码，设置完成后即可进入隐私收藏夹。';
  privatePasswordLabel.textContent = privateCollectionHasPassword ? '密码' : '设置密码';
  privatePasswordInput.placeholder = privateCollectionHasPassword ? '请输入密码' : '请设置密码';
  privatePasswordConfirmField.classList.toggle('hidden', privateCollectionHasPassword);
  privateCollectionSubmit.textContent = privateCollectionHasPassword ? '解锁' : '设置并进入';
  syncPrivatePasswordToggleIcon();
}

async function loadConfig() {
  try {
    configCache = await api.invoke('data:get-config');
  } catch (_error) {
    configCache = {
      shortcut: 'Ctrl+Q',
      sortMode: 'updatedAt',
      lastCollectionId: 'all',
      theme: 'light',
      rememberState: true,
    readClipboardOnQuicknote: false,
    dataPath: '',
    autoBackupIntervalDays: 30
    };
  }
  await loadPrivateCollectionState();
  sortMode = configCache.sortMode || 'updatedAt';
  currentCollectionId = forcedCollectionId || configCache.lastCollectionId || 'all';
  if ((!privateCollectionEnabled && currentCollectionId === privateCollectionId) || !currentCollectionId) {
    currentCollectionId = 'all';
  }
  if (privateCollectionEnabled && privateCollectionId && currentCollectionId === privateCollectionId) {
    privateCollectionUnlocked = false;
  }
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
      sortMode,
      allowPrivateCollectionAccess: isPrivateCollectionSelected() && privateCollectionUnlocked
    });
    collections = data.collections || [];
    notes = data.notes || [];
  } catch (_error) {
    collections = [];
    notes = [];
  }
  updatePrivateCollectionGate();
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
  const maxVisibleCollections = 11;
  sidebarCollections.classList.remove('is-overflowing');
  const availableHeight = sidebar.clientHeight
    - logo.offsetHeight
    - parseFloat(getComputedStyle(sidebarCollections).marginTop || '0')
    - sidebarFooter.offsetHeight;
  const collectionItems = Array.from(collectionList.querySelectorAll('.collection-item'));
  const visibleItems = collectionItems.slice(0, maxVisibleCollections);
  const listGap = parseFloat(getComputedStyle(collectionList).gap || '0');
  const visibleListHeight = visibleItems.reduce((total, item) => total + item.offsetHeight, 0)
    + Math.max(0, visibleItems.length - 1) * listGap;
  const inputStyles = getComputedStyle(collectionInputWrap);
  const inputHeight = collectionInputWrap.offsetHeight
    + parseFloat(inputStyles.marginTop || '0')
    + parseFloat(inputStyles.marginBottom || '0');
  const cappedContentHeight = visibleListHeight + inputHeight;
  const maxScrollHeight = Math.max(
    0,
    Math.min(
      availableHeight - addCollectionBtn.offsetHeight - 8,
      cappedContentHeight || collectionScroll.scrollHeight
    )
  );
  collectionScroll.style.maxHeight = maxScrollHeight > 0 ? `${maxScrollHeight}px` : '';
  const contentHeight = collectionScroll.scrollHeight + addCollectionBtn.offsetHeight + 8;
  sidebarCollections.classList.toggle(
    'is-overflowing',
    collectionScroll.scrollHeight > maxScrollHeight + 1 || contentHeight > availableHeight
  );
}

function renderCollections() {
  collectionList.innerHTML = '';

  const privateCollection = privateCollectionEnabled
    ? collections.find(item => item.id === privateCollectionId)
    : null;
  const regularCollections = collections.filter(item => item.id !== privateCollectionId);

  if (privateCollection) {
    const item = document.createElement('div');
    item.className = `collection-item ${currentCollectionId === privateCollection.id ? 'active' : ''}`;
    item.dataset.collectionId = privateCollection.id;
    item.innerHTML = `
      <span class="collection-label collection-label-lock"><img src="./assets/icons/private-lock-white.svg" alt="锁定" class="collection-lock-icon" /></span>
      ${currentCollectionId === privateCollection.id ? '<span class="collection-dot"></span>' : ''}
    `;
    item.addEventListener('click', async () => {
      currentCollectionId = privateCollection.id;
      if (settingsOpen) {
        toggleSettings(false);
      }
      if (configCache?.rememberState !== false) {
        await saveConfig();
      }
      loadData();
    });
    item.addEventListener('contextmenu', event => {
      event.preventDefault();
      showCollectionContextMenu(privateCollection, event.currentTarget);
    });
    wireCollectionDrag(item, privateCollection.id);
    collectionList.appendChild(item);
  }

  const allItem = document.createElement('div');
  allItem.className = `collection-item ${currentCollectionId === 'all' ? 'active' : ''}`;
  allItem.innerHTML = `
    <span class="collection-label">全部笔记</span>
    ${currentCollectionId === 'all' ? '<span class="collection-dot"></span>' : ''}
  `;
  allItem.addEventListener('click', async () => {
    currentCollectionId = 'all';
    forcedCollectionId = null;
    privateCollectionUnlocked = false;
    if (privateCollectionEnabled) {
      await api.invoke('data:set-private-enabled', false);
      await loadPrivateCollectionState();
    }
    if (settingsOpen) {
      toggleSettings(false);
    }
    if (configCache?.rememberState !== false) {
      await saveConfig();
    }
    loadData();
  });
  collectionList.appendChild(allItem);

  regularCollections.forEach(col => {
    const item = document.createElement('div');
    item.className = `collection-item ${currentCollectionId === col.id ? 'active' : ''}`;
    item.dataset.collectionId = col.id;
    item.innerHTML = `
      <span class="collection-label">${escapeHtml(getCollectionDisplayName(col))}</span>
      ${currentCollectionId === col.id ? '<span class="collection-dot"></span>' : ''}
    `;
    item.addEventListener('click', async () => {
      currentCollectionId = col.id;
      forcedCollectionId = null;
      if (settingsOpen) {
        toggleSettings(false);
      }
      if (col.id !== privateCollectionId) {
        privateCollectionUnlocked = false;
        if (privateCollectionEnabled) {
          await api.invoke('data:set-private-enabled', false);
          await loadPrivateCollectionState();
        }
      }
      if (configCache?.rememberState !== false) {
        await saveConfig();
      }
      loadData();
    });
    item.addEventListener('contextmenu', event => {
      event.preventDefault();
      showCollectionContextMenu(col, event.currentTarget);
    });
    wireCollectionDrag(item, col.id);
    collectionList.appendChild(item);
  });
}

function wireCollectionDrag(item, collectionId) {
  if (!item || !collectionId) return;
  item.setAttribute('draggable', 'true');
  item.addEventListener('dragstart', event => {
    draggedCollectionId = collectionId;
    item.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', collectionId);
  });
  item.addEventListener('dragend', () => {
    draggedCollectionId = null;
    item.classList.remove('dragging');
    item.classList.remove('drag-over');
  });
  item.addEventListener('dragover', event => {
    if (!draggedCollectionId || draggedCollectionId === collectionId) return;
    event.preventDefault();
    item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => {
    item.classList.remove('drag-over');
  });
  item.addEventListener('drop', async event => {
    if (!draggedCollectionId || draggedCollectionId === collectionId) return;
    event.preventDefault();
    item.classList.remove('drag-over');
    const orderedCollectionIds = Array.from(collectionList.querySelectorAll('[data-collection-id]'))
      .map(element => element.dataset.collectionId)
      .filter(Boolean);
    const sourceIndex = orderedCollectionIds.indexOf(draggedCollectionId);
    const targetIndex = orderedCollectionIds.indexOf(collectionId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextOrder = orderedCollectionIds.slice();
    const [moved] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);
    await api.invoke('data:update-collection-orders', nextOrder.map((id, index) => ({
      id,
      order: index
    })));
  });
}

function showCollectionContextMenu(collection, target) {
  contextCollectionId = collection.id;
  const rect = target.getBoundingClientRect();
  const shellRect = document.querySelector('.main-shell').getBoundingClientRect();
  collectionContextMenu.style.left = `${rect.right - shellRect.left + 8}px`;
  collectionContextMenu.style.top = `${rect.top - shellRect.top}px`;
  collectionContextMenu.classList.remove('hidden');
  deleteCollectionBtn.disabled = !!(collection.isDefault || collection.isPrivate);
}

function hideCollectionContextMenu() {
  contextCollectionId = null;
  collectionContextMenu.classList.add('hidden');
}

function showNoteContextMenu(noteId, event) {
  contextNoteId = noteId;
  const note = notes.find(item => item.id === noteId);
  contextNotePinned = !!note?.isPinnedInCollection;
  const shellRect = document.querySelector('.main-shell').getBoundingClientRect();
  const nextLeft = Math.min((event.clientX - shellRect.left) + 10, shellRect.width - 108);
  const nextTop = Math.min(event.clientY - shellRect.top, shellRect.height - 112);
  noteContextMenu.style.left = `${Math.max(0, nextLeft)}px`;
  noteContextMenu.style.top = `${Math.max(0, nextTop)}px`;
  noteContextMenu.classList.remove('hidden');
  pinNoteCardBtn.textContent = contextNotePinned ? '取消置顶' : '置顶';
}

function hideNoteContextMenu() {
  contextNoteId = null;
  contextNotePinned = false;
  noteContextMenu.classList.add('hidden');
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
  if (!collection || collection.isDefault || collection.isPrivate) return;
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

function createMetaCount(iconPath, alt, count) {
  const item = document.createElement('span');
  item.className = 'note-meta-count';
  item.innerHTML = `<img src="${iconPath}" alt="${alt}" /><span>${count}</span>`;
  return item;
}

function getCollectionDisplayName(collection) {
  return collection?.name || '';
}

function getDefaultCollection() {
  return collections.find(collection => collection.isDefault) || collections[0] || null;
}

function getTagColorClass(tag) {
  const palettes = [
    { background: '#F6F8D9', color: '#6C7A16' },
    { background: '#EAF7E5', color: '#46733D' },
    { background: '#E7F6F7', color: '#2D6E74' },
    { background: '#EEF1FF', color: '#4E5FAE' },
    { background: '#F5EDFF', color: '#7855A8' },
    { background: '#FFEFF6', color: '#A64F7A' },
    { background: '#FFF2E7', color: '#A66632' },
    { background: '#FFF8DE', color: '#92701E' }
  ];
  const hash = Array.from(String(tag || '')).reduce((sum, char, index) => sum + (char.charCodeAt(0) * (index + 17)), 0);
  return palettes[Math.abs(hash) % palettes.length];
}

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function normalizePlannedDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return '';
  }
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
}

function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}`;
}

function shiftMonthKey(monthKey, offset) {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(year, month - 1 + offset, 1, 12, 0, 0, 0);
  return getMonthKey(shifted);
}

function formatPlannedDateTag(value) {
  const normalized = normalizePlannedDate(value);
  if (!normalized) return '';
  const [, month, day] = normalized.split('-');
  return `${Number(month)}.${Number(day)}`;
}

function formatCalendarCardMonth(monthKey) {
  const [year, month] = monthKey.split('-');
  return `${year}.${month}`;
}

function getTodayKey() {
  const today = new Date();
  return `${today.getFullYear()}-${padNumber(today.getMonth() + 1)}-${padNumber(today.getDate())}`;
}

function formatMonthDayLabel(value) {
  const normalized = normalizePlannedDate(value);
  if (!normalized) return '';
  const [, month, day] = normalized.split('-');
  return `${month}.${day}`;
}

function getFirstLineText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')[0]
    .trim();
}

function getCurrentCollectionForCalendarCard() {
  if (!currentCollectionId || currentCollectionId === 'all') return null;
  return collections.find(item => item.id === currentCollectionId) || null;
}

function getCalendarCardMonth(collectionId) {
  return calendarCardMonthState.get(collectionId) || getMonthKey();
}

function getCalendarMonthPickerYear(collectionId) {
  const storedYear = Number(calendarCardMonthPickerYearState.get(collectionId));
  if (Number.isFinite(storedYear)) return storedYear;
  return Number(getCalendarCardMonth(collectionId).slice(0, 4));
}

function closeCalendarMonthPicker(shouldRender = true) {
  if (!activeCalendarMonthPickerCollectionId) return;
  activeCalendarMonthPickerCollectionId = '';
  if (shouldRender) {
    renderNotes();
  }
}

function getPlannedNotesForCollection(collectionId) {
  return notes.filter(note => note.collectionId === collectionId && normalizePlannedDate(note.plannedDate));
}

function createPlannerStatusMap(collectionId) {
  const statusMap = new Map();
  getPlannedNotesForCollection(collectionId).forEach(note => {
    const plannedDate = normalizePlannedDate(note.plannedDate);
    if (!plannedDate) return;
    if (!statusMap.has(plannedDate)) {
      statusMap.set(plannedDate, []);
    }
    statusMap.get(plannedDate).push(note);
  });
  return statusMap;
}

function isPlannerCalendarVisible() {
  if (!currentCollectionId || currentCollectionId === 'all' || isPrivateCollectionLocked()) {
    return false;
  }
  return getPlannedNotesForCollection(currentCollectionId).length > 0;
}

function setCalendarTodayLabelState(collectionId, isTodayMode) {
  if (!collectionId) return;
  calendarCardTodayLabelState.set(collectionId, !!isTodayMode);
}

function getCalendarTodayLabelState(collectionId) {
  return !!calendarCardTodayLabelState.get(collectionId);
}

function scheduleCalendarTodayLabelReset(collectionId) {
  if (!collectionId) return;
  window.clearTimeout(calendarTodayLabelTimers.get(collectionId));
  const timer = window.setTimeout(() => {
    calendarTodayLabelTimers.delete(collectionId);
    setCalendarTodayLabelState(collectionId, false);
    renderNotes();
  }, 2000);
  calendarTodayLabelTimers.set(collectionId, timer);
}

function clearCalendarHighlight() {
  if (!activeCalendarDateKey) return;
  activeCalendarDateKey = '';
  renderNotes();
}

function focusPlannedNoteCards(dateKey) {
  const targetNotes = notes.filter(note => normalizePlannedDate(note.plannedDate) === dateKey);
  if (!targetNotes.length) return false;
  activeCalendarDateKey = dateKey;
  renderNotes();
  requestAnimationFrame(() => {
    const targetCard = notesGrid.querySelector(`[data-note-id="${targetNotes[0].id}"]`);
    targetCard?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  });
  return true;
}

function createPlannerCalendarCard(collection) {
  const monthKey = getCalendarCardMonth(collection.id);
  const [year, month] = monthKey.split('-').map(Number);
  const pickerYear = getCalendarMonthPickerYear(collection.id);
  const today = new Date();
  const todayKey = getTodayKey();
  const monthStart = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const firstWeekday = (monthStart.getDay() + 6) % 7;
  const totalDays = new Date(year, month, 0).getDate();
  const noteStatusMap = createPlannerStatusMap(collection.id);

  const card = document.createElement('div');
  card.className = 'note-card planner-calendar-card';

  const header = document.createElement('div');
  header.className = 'planner-calendar-card-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'planner-calendar-card-header-left';

  const icon = document.createElement('img');
  icon.className = 'planner-calendar-card-icon';
  icon.src = plannerCalendarIconUrl;
  icon.alt = '';

  const monthBtn = document.createElement('button');
  monthBtn.type = 'button';
  monthBtn.className = 'planner-calendar-card-month-btn';
  monthBtn.textContent = `${year} / ${padNumber(month)}`;

  monthBtn.addEventListener('click', event => {
    event.stopPropagation();
    if (activeCalendarMonthPickerCollectionId === collection.id) {
      closeCalendarMonthPicker();
      return;
    }
    calendarCardMonthPickerYearState.set(collection.id, year);
    activeCalendarMonthPickerCollectionId = collection.id;
    renderNotes();
  });

  headerLeft.appendChild(icon);
  headerLeft.appendChild(monthBtn);

  const todayBadge = document.createElement('div');
  todayBadge.className = 'planner-calendar-card-today';
  const todayValue = document.createElement('span');
  todayValue.className = 'planner-calendar-card-today-value';
  todayValue.textContent = formatMonthDayLabel(todayKey);
  todayBadge.appendChild(todayValue);

  header.appendChild(headerLeft);
  header.appendChild(todayBadge);

  if (activeCalendarMonthPickerCollectionId === collection.id) {
    const monthPopover = document.createElement('div');
    monthPopover.className = 'planner-calendar-month-popover';

    const popoverHeader = document.createElement('div');
    popoverHeader.className = 'planner-calendar-month-popover-header';

    const prevYearBtn = document.createElement('button');
    prevYearBtn.type = 'button';
    prevYearBtn.className = 'planner-calendar-month-nav-btn';
    prevYearBtn.innerHTML = '&#8249;';
    prevYearBtn.setAttribute('aria-label', '上一年');
    prevYearBtn.addEventListener('click', event => {
      event.stopPropagation();
      calendarCardMonthPickerYearState.set(collection.id, pickerYear - 1);
      renderNotes();
    });

    const yearLabel = document.createElement('div');
    yearLabel.className = 'planner-calendar-month-popover-year';
    yearLabel.textContent = `${pickerYear}`;

    const nextYearBtn = document.createElement('button');
    nextYearBtn.type = 'button';
    nextYearBtn.className = 'planner-calendar-month-nav-btn';
    nextYearBtn.innerHTML = '&#8250;';
    nextYearBtn.setAttribute('aria-label', '下一年');
    nextYearBtn.addEventListener('click', event => {
      event.stopPropagation();
      calendarCardMonthPickerYearState.set(collection.id, pickerYear + 1);
      renderNotes();
    });

    popoverHeader.appendChild(prevYearBtn);
    popoverHeader.appendChild(yearLabel);
    popoverHeader.appendChild(nextYearBtn);
    monthPopover.appendChild(popoverHeader);

    const monthGrid = document.createElement('div');
    monthGrid.className = 'planner-calendar-month-grid';
    for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'planner-calendar-month-option';
      option.textContent = `${monthIndex}月`;
      const optionKey = `${pickerYear}-${padNumber(monthIndex)}`;
      option.classList.toggle('is-selected', optionKey === monthKey);
      option.addEventListener('click', event => {
        event.stopPropagation();
        calendarCardMonthState.set(collection.id, optionKey);
        activeCalendarMonthPickerCollectionId = '';
        renderNotes();
      });
      monthGrid.appendChild(option);
    }
    monthPopover.appendChild(monthGrid);
    card.appendChild(monthPopover);
  }

  const grid = document.createElement('div');
  grid.className = 'planner-calendar-grid';
  const hoverTooltip = document.createElement('div');
  hoverTooltip.className = 'planner-calendar-tooltip hidden';

  for (let index = 0; index < firstWeekday; index += 1) {
    const placeholder = document.createElement('span');
    placeholder.className = 'planner-calendar-cell planner-calendar-cell-placeholder';
    grid.appendChild(placeholder);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const dateKey = `${year}-${padNumber(month)}-${padNumber(day)}`;
    const cell = document.createElement('button');
    const hasPlannedNote = noteStatusMap.has(dateKey);
    const isFuture = dateKey > todayKey;
    const isToday = dateKey === todayKey;
    cell.type = 'button';
    cell.className = 'planner-calendar-cell';
    cell.dataset.dateKey = dateKey;
    cell.dataset.dateLabel = formatMonthDayLabel(dateKey);
    cell.classList.toggle('is-empty', !hasPlannedNote);
    cell.classList.toggle('has-note', hasPlannedNote);
    cell.classList.toggle('is-future', hasPlannedNote && isFuture);
    cell.classList.toggle('is-complete', hasPlannedNote && !isFuture);
    cell.classList.toggle('is-today', isToday);
    cell.addEventListener('click', event => {
      event.stopPropagation();
      if (isToday) {
        createNewNoteAndOpen(todayKey);
        return;
      }
      if (hasPlannedNote) {
        focusPlannedNoteCards(dateKey);
      } else {
        renderNotes();
      }
    });
    cell.addEventListener('mousemove', event => {
      if (!hasPlannedNote && !isToday) return;
      hoverTooltip.textContent = isToday ? 'today' : (cell.dataset.dateLabel || '');
      hoverTooltip.classList.remove('hidden');
      const cardRect = card.getBoundingClientRect();
      hoverTooltip.style.left = `${event.clientX - cardRect.left}px`;
      hoverTooltip.style.top = `${event.clientY - cardRect.top + 16}px`;
    });
    cell.addEventListener('mouseleave', () => {
      hoverTooltip.classList.add('hidden');
    });
    grid.appendChild(cell);
  }

  card.appendChild(header);
  card.appendChild(grid);
  card.appendChild(hoverTooltip);
  return card;
}

function renderNotes() {
  if (isPrivateCollectionLocked()) {
    notesGrid.innerHTML = '';
    noteCount.textContent = '0';
    notesArea.classList.add('empty');
    updateSelectionUi();
    renderSortMenu();
    updateScrollIndicator();
    return;
  }

  notesGrid.innerHTML = '';
  noteCount.textContent = notes.length.toString();
  notesArea.classList.toggle('empty', notes.length === 0 && !isPlannerCalendarVisible());
  if (activeCalendarDateKey && !notes.some(note => normalizePlannedDate(note.plannedDate) === activeCalendarDateKey)) {
    activeCalendarDateKey = '';
  }

  const currentCollection = getCurrentCollectionForCalendarCard();
  const newCard = document.createElement('div');
  newCard.className = 'note-card new-note';
  newCard.dataset.noteAction = 'new';
  newCard.innerHTML = '<img src="./assets/icons/add-note-new.svg" alt="新增笔记" class="new-note-icon" /><span>NEW NOTE</span>';
  notesGrid.appendChild(newCard);

  if (currentCollection && isPlannerCalendarVisible()) {
    notesGrid.appendChild(createPlannerCalendarCard(currentCollection));
  }

  notes.forEach(note => {
    const imageAttachment = (note.attachments || []).find(att => att.type === 'image');
    const card = document.createElement('div');
    const cardTypeClass = imageAttachment ? 'with-image' : 'text-card';
    card.className = `note-card ${cardTypeClass} ${sortMode === 'custom' && !selectionMode ? 'draggable' : ''}`;
    card.dataset.noteId = note.id;
    if (activeCalendarDateKey && normalizePlannedDate(note.plannedDate) === activeCalendarDateKey) {
      card.classList.add('calendar-selected');
    }

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
      img.draggable = false;
      resolveAssetUrl(imageAttachment.thumbnailPath || imageAttachment.path).then(url => {
        img.src = url;
      });
      card.appendChild(img);
    }

    if (note.isPinnedInCollection) {
      const pinLine = document.createElement('span');
      pinLine.className = 'note-card-pin-line';
      card.appendChild(pinLine);
    }

    const title = document.createElement('div');
    title.className = 'note-title';
    const fallbackTitle = getFirstLineText(htmlToPlainText(note.content || '')).slice(0, 20);
    title.innerHTML = highlightText(note.title || fallbackTitle || '未命名', searchInput.value.trim());
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
    const plannedTag = formatPlannedDateTag(note.plannedDate);
    if (plannedTag) {
      const plannedChip = document.createElement('span');
      plannedChip.className = 'note-tag-chip planner-date-chip';
      plannedChip.classList.toggle('is-future', normalizePlannedDate(note.plannedDate) >= getTodayKey());
      plannedChip.textContent = plannedTag;
      tagWrap.appendChild(plannedChip);
    }
    const maxTagCount = plannedTag ? 2 : 3;
    const firstTags = (note.tags || []).slice(0, maxTagCount);
    firstTags.forEach(tag => {
      tagWrap.appendChild(createTagChip(tag, getTagColorClass(tag)));
    });

    const counts = document.createElement('div');
    counts.className = 'note-meta-counts';
    const imageCount = (note.attachments || []).filter(att => att.type === 'image').length;
    const audioCount = (note.attachments || []).filter(att => att.type === 'audio').length;
    if (imageCount > 0) {
      counts.appendChild(createMetaCount('./assets/icons/pic.svg', '图片', imageCount));
    }
    if (audioCount > 0) {
      counts.appendChild(createMetaCount('./assets/icons/voice.svg', '录音', audioCount));
    }

    meta.appendChild(tagWrap);
    if (counts.childElementCount > 0) {
      meta.appendChild(counts);
    }
    card.appendChild(meta);

    card.addEventListener('click', event => {
      if (Date.now() < suppressCardClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (selectionMode) return;
      event.stopPropagation();
      activeCalendarDateKey = '';
      api.invoke('app:show-note', note.id);
    });

    card.addEventListener('contextmenu', event => {
      if (selectionMode) return;
      event.preventDefault();
      event.stopPropagation();
      showNoteContextMenu(note.id, event);
    });

    notesGrid.appendChild(card);
  });

  updateSelectionUi();
  renderSortMenu();
  updateScrollIndicator();
}

function handleNotesGridClick(event) {
  if (Date.now() < suppressCardClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const newNoteCard = event.target.closest('[data-note-action="new"]');
  if (newNoteCard) {
    clearCalendarHighlight();
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
    if (collection.id === privateCollectionId) return;
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
  event.dataTransfer.setData('text/plain', draggedId);
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  Array.from(notesGrid.querySelectorAll('.note-card.drag-over')).forEach(card => {
    card.classList.remove('drag-over');
  });
  draggedId = null;
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  Array.from(notesGrid.querySelectorAll('.note-card.drag-over')).forEach(card => {
    if (card !== event.currentTarget) {
      card.classList.remove('drag-over');
    }
  });
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
  suppressCardClickUntil = Date.now() + 220;
  const orderedIds = Array.from(notesGrid.querySelectorAll('[data-note-id]'))
    .map(card => card.dataset.noteId)
    .filter(Boolean);
  const draggedIndex = orderedIds.indexOf(draggedId);
  const targetIndex = orderedIds.indexOf(target.dataset.noteId);
  if (draggedIndex < 0 || targetIndex < 0) return;
  const nextOrderedIds = orderedIds.slice();
  [nextOrderedIds[draggedIndex], nextOrderedIds[targetIndex]] = [nextOrderedIds[targetIndex], nextOrderedIds[draggedIndex]];
  const orderMap = new Map(nextOrderedIds.map((id, index) => [id, index]));
  notes = notes
    .slice()
    .sort((a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999))
    .map(note => ({ ...note, order: orderMap.get(note.id) ?? note.order }));
  renderNotes();
  await api.invoke('data:update-orders', notes.map((note, index) => ({
    id: note.id,
    order: index
  })));
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

function toggleSelectAllNotes() {
  if (!selectionMode) return;
  if (selectedNoteIds.size === notes.length && notes.length > 0) {
    selectedNoteIds.clear();
  } else {
    selectedNoteIds = new Set(notes.map(note => note.id));
  }
  updateSelectionUi();
  renderNotes();
}

function updateSelectionUi() {
  selectionBar.classList.toggle('hidden', !selectionMode);
  selectionCount.textContent = `已选择 ${selectedNoteIds.size} 条`;
  if (selectAllBtn) {
    selectAllBtn.textContent = selectedNoteIds.size === notes.length && notes.length > 0 ? '取消全选' : '全选';
    selectAllBtn.disabled = notes.length === 0;
  }
  deleteSelectionBtn.disabled = selectedNoteIds.size === 0;
  moveSelectionBtn.disabled = selectedNoteIds.size === 0;
  exportSelectionBtn.disabled = selectedNoteIds.size === 0;
  if (mergeSelectionBtn) {
    mergeSelectionBtn.disabled = selectedNoteIds.size < 2;
  }
}

async function deleteSelectedNotes() {
  if (selectedNoteIds.size === 0) return;
  const confirmed = window.confirm(`确认删除已选择的 ${selectedNoteIds.size} 条笔记吗？`);
  if (!confirmed) return;
  await api.invoke('data:delete-notes', Array.from(selectedNoteIds));
  selectedNoteIds.clear();
  toggleSelectionMode(false);
}

async function pinNoteFromCard() {
  if (!contextNoteId) return;
  const noteId = contextNoteId;
  const nextPinned = !contextNotePinned;
  hideNoteContextMenu();
  await api.invoke('data:update-note', {
    noteId,
    patch: {
      isPinnedInCollection: nextPinned
    }
  });
}

async function exportNoteImageFromCard() {
  if (!contextNoteId) return;
  const noteId = contextNoteId;
  hideNoteContextMenu();
  const exportPath = await api.invoke('data:export-note-image', noteId);
  setSettingsStatus(exportPath ? `已导出图片并复制到剪贴板：${exportPath}` : '未导出图片');
}

async function deleteNoteFromCard() {
  if (!contextNoteId) return;
  const noteId = contextNoteId;
  hideNoteContextMenu();
  const confirmed = window.confirm('确认删除这条笔记吗？');
  if (!confirmed) return;
  await api.invoke('data:delete-notes', [noteId]);
}

async function mergeSelectedNotes() {
  if (selectedNoteIds.size < 2) return;
  const orderedSelected = notes
    .filter(note => selectedNoteIds.has(note.id))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const [firstNote, ...restNotes] = orderedSelected;
  if (!firstNote) return;
  const mergedContent = [
    firstNote.content || '',
    ...restNotes.map(note => note.content || '')
  ].filter(Boolean).join('<br>');
  const mergedAttachments = [
    ...(firstNote.attachments || []),
    ...restNotes.flatMap(note => note.attachments || [])
  ];
  await api.invoke('data:update-note', {
    noteId: firstNote.id,
    patch: {
      content: mergedContent,
      attachments: mergedAttachments
    }
  });
  if (restNotes.length) {
    await api.invoke('data:delete-notes', restNotes.map(note => note.id));
  }
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
  document.body.classList.toggle('settings-open', settingsOpen);
}

function hydrateSettingsPanel() {
  if (!configCache) return;
  dataPathValue.textContent = configCache.dataPath || '未找到存储路径';
  backupIntervalInput.value = String(Math.max(0, Number(configCache.autoBackupIntervalDays) || 0));
  shortcutInput.value = configCache.shortcut || 'Ctrl+Q';
  rememberModeToggle.checked = configCache.rememberState !== false;
  clipboardToggle.checked = configCache.readClipboardOnQuicknote === true;
}

function setSettingsStatus(message) {
  settingsStatus.textContent = message;
}

async function saveSettings() {
  const shortcut = shortcutInput.value.trim() || 'Ctrl+Q';
  const rememberState = rememberModeToggle.checked;
  const readClipboardOnQuicknote = clipboardToggle.checked;
  const autoBackupIntervalDays = Math.max(0, Number.parseInt(backupIntervalInput.value, 10) || 0);
  backupIntervalInput.value = String(autoBackupIntervalDays);
  await saveConfig({ shortcut, rememberState, readClipboardOnQuicknote, autoBackupIntervalDays });
  setSettingsStatus('设置已保存');
}

async function saveToggleSettingsImmediately() {
  const rememberState = rememberModeToggle.checked;
  const readClipboardOnQuicknote = clipboardToggle.checked;
  await saveConfig({ rememberState, readClipboardOnQuicknote });
  setSettingsStatus('设置已即时生效');
}

async function saveBackupIntervalSettings() {
  const autoBackupIntervalDays = Math.max(0, Number.parseInt(backupIntervalInput.value, 10) || 0);
  backupIntervalInput.value = String(autoBackupIntervalDays);
  await saveConfig({ autoBackupIntervalDays });
  setSettingsStatus(autoBackupIntervalDays > 0
    ? `自动备份周期已设为 ${autoBackupIntervalDays} 天`
    : '自动备份已关闭');
}

async function createNewNoteAndOpen(plannedDate = '') {
  try {
    if (isPrivateCollectionLocked()) {
      privatePasswordInput.focus();
      return;
    }
    setBuildStamp('new note: click');
    let collectionId = currentCollectionId;
    if (collectionId === 'all') {
      const preferredCollection = collections.find(item => item.id === configCache?.lastCollectionId && item.id !== privateCollectionId);
      collectionId = preferredCollection?.id || getDefaultCollection()?.id || collections.find(item => item.id !== privateCollectionId)?.id;
    }
    if (collectionId === 'all' || !collections.some(item => item.id === collectionId)) {
      collectionId = getDefaultCollection()?.id || collections.find(item => item.id !== privateCollectionId)?.id || '';
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
    const result = await api.invoke('app:show-note', {
      draft: true,
      collectionId,
      mode: 'edit',
      plannedDate: normalizePlannedDate(plannedDate)
    });
    setBuildStamp(result ? 'new note: opened' : 'new note: no response', !result);
  } catch (error) {
    setBuildStamp(`new note error: ${error.message}`, true);
  }
}

async function openPrivateCollectionFromSettings() {
  privateCollectionOpening = true;
  try {
    const collection = await api.invoke('data:ensure-private-collection');
    forcedCollectionId = collection?.id || forcedCollectionId;
    await loadPrivateCollectionState();
    forcedCollectionId = collection?.id || privateCollectionId || null;
    currentCollectionId = collection?.id || privateCollectionId;
    privateCollectionUnlocked = false;
    toggleSettings(false);
    if (configCache?.rememberState !== false) {
      await saveConfig({ lastCollectionId: currentCollectionId });
    }
    await loadData();
    updatePrivateCollectionGate();
    window.setTimeout(() => {
      privatePasswordInput?.focus();
    }, 30);
  } finally {
    privateCollectionOpening = false;
  }
}

async function submitPrivateCollectionPassword() {
  if (!isPrivateCollectionSelected()) return;
  const password = privatePasswordInput.value.trim();
  if (!password) {
    setPrivateCollectionStatus('请输入密码。', 'error');
    return;
  }

  if (!privateCollectionHasPassword) {
    const confirmPassword = privatePasswordConfirmInput.value.trim();
    if (password.length < 4) {
      setPrivateCollectionStatus('密码至少需要 4 个字符。', 'error');
      return;
    }
    if (password !== confirmPassword) {
      setPrivateCollectionStatus('两次输入的密码不一致。', 'error');
      return;
    }
    const saved = await api.invoke('data:set-private-password', password);
    if (!saved) {
      setPrivateCollectionStatus('密码设置失败，请稍后重试。', 'error');
      return;
    }
    await loadPrivateCollectionState();
    privateCollectionUnlocked = true;
    setPrivateCollectionStatus('密码已设置，正在进入隐私收藏夹。', 'success');
    await loadData();
    return;
  }

  const verified = await api.invoke('data:verify-private-password', password);
  if (!verified) {
    setPrivateCollectionStatus('密码错误，请重新输入。', 'error');
    return;
  }
  privateCollectionUnlocked = true;
  setPrivateCollectionStatus('');
  await loadData();
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

searchPill?.addEventListener('mousedown', () => {
  searchPill.classList.remove('is-pressed');
  void searchPill.offsetWidth;
  searchPill.classList.add('is-pressed');
});

searchPill?.addEventListener('animationend', () => {
  searchPill.classList.remove('is-pressed');
});

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

selectAllBtn?.addEventListener('click', () => {
  toggleSelectAllNotes();
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

openPrivateCollectionBtn?.addEventListener('click', () => {
  openPrivateCollectionFromSettings();
});

backupDataBtn?.addEventListener('click', async () => {
  const backupPath = await api.invoke('data:create-backup');
  setSettingsStatus(backupPath ? `备份已创建：${backupPath}` : '备份失败');
});

importBackupBtn?.addEventListener('click', async () => {
  const importPath = await api.invoke('data:import-backup');
  setSettingsStatus(importPath ? `已导入备份：${importPath}` : '未导入备份');
});

saveBackupIntervalBtn?.addEventListener('click', () => {
  saveBackupIntervalSettings();
});

backupIntervalInput?.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveBackupIntervalSettings();
  }
});

saveShortcutBtn?.addEventListener('click', () => {
  saveSettings();
});

rememberModeToggle?.addEventListener('change', () => {
  saveToggleSettingsImmediately();
});

clipboardToggle?.addEventListener('change', () => {
  saveToggleSettingsImmediately();
});

addCollectionBtn?.addEventListener('click', () => {
  showCollectionInput();
});

privatePasswordToggle?.addEventListener('click', () => {
  privatePasswordVisible = !privatePasswordVisible;
  privatePasswordInput.type = privatePasswordVisible ? 'text' : 'password';
  privatePasswordConfirmInput.type = privatePasswordVisible ? 'text' : 'password';
  syncPrivatePasswordToggleIcon();
});

privateCollectionSubmit?.addEventListener('click', () => {
  submitPrivateCollectionPassword();
});

[privatePasswordInput, privatePasswordConfirmInput].forEach(input => {
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPrivateCollectionPassword();
    }
  });
});

renameCollectionBtn?.addEventListener('click', () => {
  if (contextCollectionId) {
    beginCollectionRename(contextCollectionId);
  }
});

deleteCollectionBtn?.addEventListener('click', () => {
  handleDeleteCollection();
});

pinNoteCardBtn?.addEventListener('click', () => {
  pinNoteFromCard();
});

exportNoteImageBtn?.addEventListener('click', () => {
  exportNoteImageFromCard();
});

deleteNoteCardBtn?.addEventListener('click', () => {
  deleteNoteFromCard();
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

mergeSelectionBtn?.addEventListener('click', () => {
  mergeSelectedNotes();
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
mainEdgeZones.forEach(edge => {
  edge.addEventListener('dblclick', () => {
    api.invoke('app:toggle-main-expanded');
  });
});

document.addEventListener('click', event => {
  if (!sortMenu.classList.contains('hidden') && !sortMenu.contains(event.target) && event.target !== sortBtn && !sortBtn.contains(event.target)) {
    sortMenu.classList.add('hidden');
  }
  if (!event.target.closest('.planner-calendar-month-popover') && !event.target.closest('.planner-calendar-card-month-btn')) {
    closeCalendarMonthPicker();
  }
  if (!collectionContextMenu.classList.contains('hidden') && !collectionContextMenu.contains(event.target)) {
    hideCollectionContextMenu();
  }
  if (!noteContextMenu.classList.contains('hidden') && !noteContextMenu.contains(event.target)) {
    hideNoteContextMenu();
  }
  if (!collectionDeleteModal.classList.contains('hidden') && event.target === collectionDeleteModal) {
    closeDeleteCollectionModal();
  }
  if (!event.target.closest('.planner-calendar-card') && !event.target.closest('[data-note-id]')) {
    clearCalendarHighlight();
  }
});

api.on('data:updated', async () => {
  if (privateCollectionOpening) return;
  const shouldRestorePrivateView = privateCollectionEnabled && currentCollectionId === privateCollectionId;
  await loadConfig();
  if (shouldRestorePrivateView && privateCollectionId) {
    forcedCollectionId = privateCollectionId;
    currentCollectionId = privateCollectionId;
    privateCollectionUnlocked = true;
  }
  await loadData();
});

async function init() {
  try {
    setBuildStamp('init: loading');
    syncPrivatePasswordToggleIcon();
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
