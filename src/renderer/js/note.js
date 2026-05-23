const api = (() => {
  if (window.quickNoteAPI) return window.quickNoteAPI;
  if (window.api) return window.api;
  try {
    const { ipcRenderer, clipboard } = require('electron');
    const fs = require('fs');
    const path = require('path');
    return {
      invoke(channel, payload) {
        return ipcRenderer.invoke(channel, payload);
      },
      on(channel, callback) {
        const listener = (_event, value) => callback(value);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
      },
      async resolveAssetUrl(relativePath) {
        const documentsPath = await ipcRenderer.invoke('app:get-path', 'documents');
        const fullPath = path.join(documentsPath, 'QuickNote', relativePath);
        return `file://${fullPath.replace(/\\/g, '/')}`;
      },
      readClipboardImage() {
        const image = clipboard.readImage();
        if (image.isEmpty()) return null;
        return Uint8Array.from(image.toPNG());
      },
      readFileBuffer(filePath) {
        return Uint8Array.from(fs.readFileSync(filePath));
      },
      extname(filePath) {
        return path.extname(filePath);
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
      },
      readClipboardImage() {
        return null;
      },
      readFileBuffer() {
        return null;
      },
      extname() {
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

function normalizeTags(input) {
  return (Array.isArray(input) ? input : String(input || '').split(/[\uFF0C,]/))
    .map(tag => String(tag || '').trim())
    .filter(Boolean);
}

function cloneAttachments(list = []) {
  return list.map(item => ({ ...item }));
}

function sameList(left = [], right = []) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function insertPlainTextAtCursor(text) {
  const safeText = String(text || '');
  if (!safeText) return;
  if (document.queryCommandSupported?.('insertText')) {
    document.execCommand('insertText', false, safeText);
    return;
  }
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(safeText);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function normalizeStoredContentHtml(input) {
  return String(input || '').replace(/\r?\n/g, '<br>');
}

function serializeEditorHtml(editor) {
  return String(editor?.innerHTML || '')
    .replace(/<div><br><\/div>/gi, '<br>')
    .replace(/<\/div>\s*<div>/gi, '<br>')
    .replace(/<\/p>\s*<p>/gi, '<br>')
    .replace(/<(div|p)(\s[^>]*)?>/gi, '')
    .replace(/<\/(div|p)>/gi, '')
    .replace(/\r?\n/g, '<br>')
    .replace(/(<br>\s*){3,}/gi, '<br><br>')
    .trim();
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getPreferredAudioMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ];
  return candidates.find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) || '';
}

async function resolveAssetUrl(relativePath) {
  return api.resolveAssetUrl(relativePath);
}

const pinBtn = document.getElementById('pinBtn');
const closeNote = document.getElementById('closeNote');
const noteCollectionSelect = document.getElementById('noteCollectionSelect');
const noteHeaderTitle = document.getElementById('noteHeaderTitle');
const noteHeader = document.querySelector('.note-header');
const noteHeaderFocusZone = document.getElementById('noteHeaderFocusZone');
const noteBody = document.getElementById('noteBody');
const noteTitle = document.getElementById('noteTitle');
const noteAttachments = document.getElementById('noteAttachments');
const noteToolbar = document.getElementById('noteToolbar');
const noteContent = document.getElementById('noteContent');
const noteTags = document.getElementById('noteTags');
const noteCalendarBtn = document.getElementById('noteCalendarBtn');
const noteDateTag = document.getElementById('noteDateTag');
const noteCalendarPopover = document.getElementById('noteCalendarPopover');
const noteCalendarMonthBtn = document.getElementById('noteCalendarMonthBtn');
const noteCalendarMonthInput = document.getElementById('noteCalendarMonthInput');
const noteCalendarPrevBtn = document.getElementById('noteCalendarPrevBtn');
const noteCalendarNextBtn = document.getElementById('noteCalendarNextBtn');
const noteCalendarClearBtn = document.getElementById('noteCalendarClearBtn');
const noteCalendarGrid = document.getElementById('noteCalendarGrid');
const saveNoteBtn = document.getElementById('saveNoteBtn');
const noteRecordBtn = document.getElementById('noteRecordBtn');
const noteImageBtn = document.getElementById('noteImageBtn');
const noteHighlightBtn = document.getElementById('noteHighlightBtn');
const noteBoldBtn = document.getElementById('noteBoldBtn');
const noteStrikeBtn = document.getElementById('noteStrikeBtn');
const noteTagBtn = document.getElementById('noteTagBtn');
const fontPlus = document.getElementById('fontPlus');
const fontMinus = document.getElementById('fontMinus');
const noteResizeHandle = document.getElementById('noteResizeHandle');
const noteCard = document.querySelector('.note-card');

let currentNoteId = null;
let currentCollectionId = null;
let attachments = [];
let isPinned = false;
let isRecording = false;
let recorder = null;
let recordStart = 0;
let isDraft = false;
let originalSnapshot = null;
let currentReadOnly = true;
let currentAudioPlayer = null;
let currentAudioButton = null;
let resizeSession = null;
let dragAttachmentIndex = null;
let dragAttachmentType = null;
let qPressed = false;
let popupOpacity = 1;
let recordingPreview = null;
let recordingTimer = null;
let currentPlannedDate = '';
let noteCalendarMonth = '';
let attachmentUrlCache = new Map();
let opacityIndicatorTimer = null;
const HIGHLIGHT_COLOR = '#F3F198';
const STRIKE_TEXT_COLOR = '#9AA092';
const FONT_SIZE_STEPS = [10, 12, 14, 16, 18];
let noteOpenToken = 0;
let lastLoadedPayloadKey = '';
let editorHistory = [];
let editorHistoryIndex = -1;
let suppressEditorHistory = false;
let pendingHistoryFrame = 0;
let savedEditorSelection = null;

function getDisplayTitle(value) {
  return String(value || '').trim() || '\u65b0\u5efa\u7b14\u8bb0';
}

function syncHeaderTitle() {
  noteHeaderTitle.textContent = getDisplayTitle(noteTitle.value);
}

function getFirstLineText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')[0]
    .trim();
}

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function normalizePlannedDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return '';
  }
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
}

function createLocalDate(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function getTodayKey() {
  const today = new Date();
  return `${today.getFullYear()}-${padNumber(today.getMonth() + 1)}-${padNumber(today.getDate())}`;
}

function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}`;
}

function formatPlannedDateTag(value) {
  const normalized = normalizePlannedDate(value);
  if (!normalized) return '';
  const [, month, day] = normalized.split('-');
  return `${Number(month)}.${Number(day)}`;
}

function isPlannedDateTodayOrFuture(value) {
  const normalized = normalizePlannedDate(value);
  if (!normalized) return false;
  return normalized >= getTodayKey();
}

function formatCalendarMonthLabel(monthKey) {
  if (!monthKey) return '';
  const [year, month] = monthKey.split('-');
  return `${year}.${month}`;
}

function shiftMonthKey(monthKey, offset) {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(year, month - 1 + offset, 1, 12, 0, 0, 0);
  return getMonthKey(shifted);
}

function ensureNoteCalendarMonth() {
  if (noteCalendarMonth) return noteCalendarMonth;
  noteCalendarMonth = currentPlannedDate ? currentPlannedDate.slice(0, 7) : getMonthKey();
  return noteCalendarMonth;
}

function renderPlannedDateTag() {
  const label = formatPlannedDateTag(currentPlannedDate);
  noteDateTag.textContent = label;
  noteDateTag.classList.toggle('hidden', !label);
  noteDateTag.classList.toggle('is-future', isPlannedDateTodayOrFuture(currentPlannedDate));
}

function renderNoteCalendarGrid() {
  if (!noteCalendarGrid) return;
  const monthKey = ensureNoteCalendarMonth();
  noteCalendarMonthBtn.textContent = formatCalendarMonthLabel(monthKey);
  noteCalendarMonthInput.value = monthKey;
  noteCalendarGrid.innerHTML = '';

  const [year, month] = monthKey.split('-').map(Number);
  const firstDay = createLocalDate(year, month - 1, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const totalDays = new Date(year, month, 0).getDate();
  const todayKey = getTodayKey();

  for (let index = 0; index < firstWeekday; index += 1) {
    const placeholder = document.createElement('span');
    placeholder.className = 'note-calendar-day-placeholder';
    noteCalendarGrid.appendChild(placeholder);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const dateKey = `${year}-${padNumber(month)}-${padNumber(day)}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-calendar-day';
    button.textContent = String(day);
    button.classList.toggle('is-selected', currentPlannedDate === dateKey);
    button.classList.toggle('is-today', todayKey === dateKey);
    button.addEventListener('click', () => {
      currentPlannedDate = currentPlannedDate === dateKey ? '' : dateKey;
      noteCalendarMonth = dateKey.slice(0, 7);
      renderPlannedDateTag();
      renderNoteCalendarGrid();
    });
    noteCalendarGrid.appendChild(button);
  }
}

function setCalendarPopoverOpen(isOpen) {
  noteCalendarPopover.classList.toggle('hidden', !isOpen);
  noteCalendarBtn?.classList.toggle('active', isOpen);
  if (isOpen) {
    if (currentReadOnly) {
      setReadOnly(false);
    }
    renderNoteCalendarGrid();
  }
}

function applyPopupOpacity() {
  if (!noteCard) return;
  noteCard.style.opacity = popupOpacity.toFixed(2);
}

function flashOpacityIndicator() {
  if (!noteCard) return;
  noteCard.classList.add('is-adjusting-opacity');
  window.clearTimeout(opacityIndicatorTimer);
  opacityIndicatorTimer = window.setTimeout(() => {
    noteCard.classList.remove('is-adjusting-opacity');
  }, 260);
}

function setNoteBodyLoadingState(isLoading) {
  noteBody?.classList.toggle('is-loading', isLoading);
  noteCard?.classList.toggle('is-opening', isLoading);
}

function resetNoteViewForOpen() {
  attachmentUrlCache = new Map();
  noteTitle.value = '';
  syncHeaderTitle();
  noteContent.innerHTML = '';
  noteTags.value = '';
  currentPlannedDate = '';
  noteCalendarMonth = '';
  renderPlannedDateTag();
  setCalendarPopoverOpen(false);
  attachments = [];
  noteAttachments.innerHTML = '';
  noteCollectionSelect.innerHTML = '';
}

function prepareNoteOpenFrame() {
  noteOpenToken += 1;
  lastLoadedPayloadKey = '';
  setNoteBodyLoadingState(true);
  resetNoteViewForOpen();
}

async function flushRenderFrames(count = 2) {
  for (let index = 0; index < count; index += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 16));
  }
}

async function waitForMinimumLoading(startedAt, minimum = 140) {
  const elapsed = Date.now() - startedAt;
  if (elapsed >= minimum) return;
  await new Promise(resolve => window.setTimeout(resolve, minimum - elapsed));
}

function getNodeTextLength(node) {
  if (!node) return 0;
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.length;
  }
  if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
    return 1;
  }
  return Array.from(node.childNodes || []).reduce((total, child) => total + getNodeTextLength(child), 0);
}

function captureSelectionOffsets(editor) {
  const range = getSelectionRangeWithinEditor(editor);
  if (!range) return null;
  const startRange = document.createRange();
  startRange.selectNodeContents(editor);
  startRange.setEnd(range.startContainer, range.startOffset);
  const start = getNodeTextLength(startRange.cloneContents());
  const length = getNodeTextLength(range.cloneContents());
  return {
    start,
    end: start + length
  };
}

function getNodeIndex(node) {
  if (!node?.parentNode) return 0;
  return Array.prototype.indexOf.call(node.parentNode.childNodes, node);
}

function resolveSelectionPoint(root, rawOffset) {
  let offset = Math.max(0, rawOffset);
  let fallback = { container: root, offset: root.childNodes.length };
  const visit = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent.length;
      fallback = { container: node, offset: length };
      if (offset <= length) {
        return { container: node, offset };
      }
      offset -= length;
      return null;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
      const beforePoint = { container: node.parentNode, offset: getNodeIndex(node) };
      const afterPoint = { container: node.parentNode, offset: getNodeIndex(node) + 1 };
      fallback = afterPoint;
      if (offset <= 0) {
        return beforePoint;
      }
      offset -= 1;
      if (offset <= 0) {
        return afterPoint;
      }
      return null;
    }
    const children = Array.from(node.childNodes || []);
    for (const child of children) {
      const point = visit(child);
      if (point) {
        return point;
      }
    }
    return null;
  };
  return visit(root) || fallback;
}

function restoreSelectionOffsets(editor, selection) {
  if (!selection) return;
  const startPoint = resolveSelectionPoint(editor, selection.start);
  const endPoint = resolveSelectionPoint(editor, selection.end);
  const range = document.createRange();
  range.setStart(startPoint.container, startPoint.offset);
  range.setEnd(endPoint.container, endPoint.offset);
  const nextSelection = window.getSelection();
  nextSelection.removeAllRanges();
  nextSelection.addRange(range);
}

function captureEditorSnapshot() {
  return {
    html: noteContent.innerHTML,
    selection: captureSelectionOffsets(noteContent)
  };
}

function snapshotEquals(left, right) {
  return !!left
    && !!right
    && left.html === right.html
    && (left.selection?.start ?? null) === (right.selection?.start ?? null)
    && (left.selection?.end ?? null) === (right.selection?.end ?? null);
}

function pushEditorHistory() {
  if (suppressEditorHistory) return;
  const snapshot = captureEditorSnapshot();
  const currentSnapshot = editorHistory[editorHistoryIndex];
  if (snapshotEquals(currentSnapshot, snapshot)) return;
  editorHistory = editorHistory.slice(0, editorHistoryIndex + 1);
  editorHistory.push(snapshot);
  if (editorHistory.length > 120) {
    editorHistory.shift();
  } else {
    editorHistoryIndex += 1;
    return;
  }
  editorHistoryIndex = editorHistory.length - 1;
}

function initializeEditorHistory() {
  if (pendingHistoryFrame) {
    window.cancelAnimationFrame(pendingHistoryFrame);
    pendingHistoryFrame = 0;
  }
  suppressEditorHistory = true;
  editorHistory = [];
  editorHistoryIndex = -1;
  suppressEditorHistory = false;
  pushEditorHistory();
}

function restoreEditorSnapshot(snapshot) {
  if (!snapshot) return false;
  suppressEditorHistory = true;
  noteContent.innerHTML = snapshot.html;
  restoreSelectionOffsets(noteContent, snapshot.selection);
  suppressEditorHistory = false;
  savedEditorSelection = cloneEditorRange(getSelectionRangeWithinEditor(noteContent));
  return true;
}

function undoEditorChange() {
  if (editorHistoryIndex <= 0) return false;
  editorHistoryIndex -= 1;
  return restoreEditorSnapshot(editorHistory[editorHistoryIndex]);
}

function redoEditorChange() {
  if (editorHistoryIndex >= editorHistory.length - 1) return false;
  editorHistoryIndex += 1;
  return restoreEditorSnapshot(editorHistory[editorHistoryIndex]);
}

function queueHistorySnapshot() {
  if (suppressEditorHistory || pendingHistoryFrame) return;
  pendingHistoryFrame = window.requestAnimationFrame(() => {
    pendingHistoryFrame = 0;
    pushEditorHistory();
  });
}

function cloneEditorRange(range) {
  if (!range) return null;
  try {
    return range.cloneRange();
  } catch (_error) {
    return null;
  }
}

function rememberEditorSelection() {
  savedEditorSelection = cloneEditorRange(getSelectionRangeWithinEditor(noteContent));
}

function restoreEditorSelection() {
  if (!savedEditorSelection) return false;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedEditorSelection);
  return true;
}

function runWithEditorSelection(mutator) {
  noteContent.focus();
  restoreEditorSelection();
  const changed = mutator();
  rememberEditorSelection();
  noteContent.focus();
  return changed;
}

function applyTrackedEditorMutation(mutator) {
  pushEditorHistory();
  const changed = runWithEditorSelection(mutator);
  if (!changed) return false;
  pushEditorHistory();
  return true;
}

function adjustPopupOpacity(delta) {
  popupOpacity = Math.min(1, Math.max(0.2, popupOpacity + delta));
  applyPopupOpacity();
  flashOpacityIndicator();
}

function getSelectionRangeWithinEditor(editor) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  if (!commonAncestor || !editor.contains(commonAncestor)) return null;
  return range;
}

function getSelectionFontSize(editor, range) {
  let node = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : range.startContainer;
  while (node && node !== editor) {
    const size = parseFloat(window.getComputedStyle(node).fontSize || '');
    if (Number.isFinite(size)) {
      return size;
    }
    node = node.parentElement;
  }
  return parseFloat(window.getComputedStyle(editor).fontSize || '14') || 14;
}

function clearInlineFontSize(root) {
  if (!root) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    const element = root;
    if (element.style?.fontSize) {
      element.style.fontSize = '';
      if (!element.getAttribute('style')) {
        element.removeAttribute('style');
      }
    }
    if (element.tagName === 'FONT') {
      element.removeAttribute('size');
    }
  }
  Array.from(root.childNodes || []).forEach(child => clearInlineFontSize(child));
}

function applyFontSizeToSelection(editor, nextSize) {
  const range = getSelectionRangeWithinEditor(editor);
  if (!range || range.collapsed) return false;
  const fragment = range.extractContents();
  clearInlineFontSize(fragment);
  const wrapper = document.createElement('span');
  wrapper.style.fontSize = `${nextSize}px`;
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);
  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

function getNextFontStepSize(currentSize, direction) {
  const nearestStep = FONT_SIZE_STEPS.reduce((closest, step) => (
    Math.abs(step - currentSize) < Math.abs(closest - currentSize) ? step : closest
  ), 14);
  const currentIndex = FONT_SIZE_STEPS.indexOf(nearestStep);
  if (direction > 0) {
    return FONT_SIZE_STEPS[Math.min(FONT_SIZE_STEPS.length - 1, currentIndex + 1)];
  }
  return FONT_SIZE_STEPS[Math.max(0, currentIndex - 1)];
}

function adjustSelectedFontSize(direction) {
  const range = getSelectionRangeWithinEditor(noteContent);
  if (!range || range.collapsed) return;
  const currentSize = getSelectionFontSize(noteContent, range);
  const nextSize = getNextFontStepSize(currentSize, direction);
  applyTrackedEditorMutation(() => applyFontSizeToSelection(noteContent, nextSize));
}

function clearStrikeFormatting(root) {
  if (!root) return;
  Array.from(root.childNodes || []).forEach(child => clearStrikeFormatting(child));
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const element = root;
  if (element.dataset?.noteStrike === 'true') {
    unwrapElement(element);
    return;
  }
  if (element.style?.textDecoration === 'line-through') {
    element.style.textDecoration = '';
  }
  if (normalizeColorValue(element.style?.color) === normalizeColorValue(STRIKE_TEXT_COLOR)) {
    element.style.color = '';
  }
  if (!element.getAttribute('style')) {
    element.removeAttribute('style');
  }
}

function findStrikeAncestor(editor, node) {
  let current = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (current && current !== editor) {
    if (current.nodeType === Node.ELEMENT_NODE && current.dataset?.noteStrike === 'true') {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function getRangeStrikeAncestor(editor, range) {
  const startStrike = findStrikeAncestor(editor, range.startContainer);
  const endStrike = findStrikeAncestor(editor, range.endContainer);
  if (startStrike && startStrike === endStrike) {
    return startStrike;
  }
  return null;
}

function isSelectionInsideStrike(editor, range) {
  if (getRangeStrikeAncestor(editor, range)) return true;
  return !!range.cloneContents().querySelector?.('[data-note-strike="true"]');
}

function removeStrikeFromRange(editor, range, strikeAncestor) {
  if (!strikeAncestor) return false;
  const fragment = range.extractContents();
  const marker = document.createComment('strike-marker');
  const startMarker = document.createComment('strike-selection-start');
  const endMarker = document.createComment('strike-selection-end');
  range.insertNode(marker);

  const trailingWrapper = strikeAncestor.cloneNode(false);
  while (marker.nextSibling) {
    trailingWrapper.appendChild(marker.nextSibling);
  }

  const insertionFragment = document.createDocumentFragment();
  insertionFragment.appendChild(startMarker);
  insertionFragment.appendChild(fragment);
  insertionFragment.appendChild(endMarker);
  strikeAncestor.parentNode.insertBefore(insertionFragment, strikeAncestor.nextSibling);
  if (trailingWrapper.childNodes.length > 0) {
    strikeAncestor.parentNode.insertBefore(trailingWrapper, endMarker.nextSibling);
  }

  marker.remove();
  if (!strikeAncestor.textContent && !strikeAncestor.querySelector?.('img, audio, video, br')) {
    strikeAncestor.remove();
  }

  const selection = window.getSelection();
  const nextRange = document.createRange();
  nextRange.setStartAfter(startMarker);
  nextRange.setEndBefore(endMarker);
  startMarker.remove();
  endMarker.remove();
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

function toggleStrikeOnSelection(editor) {
  const range = getSelectionRangeWithinEditor(editor);
  if (!range || range.collapsed) return false;
  const activeStrike = getRangeStrikeAncestor(editor, range);
  if (activeStrike) {
    return removeStrikeFromRange(editor, range, activeStrike);
  }
  const shouldRemove = isSelectionInsideStrike(editor, range);
  const fragment = range.extractContents();
  const selection = window.getSelection();
  if (shouldRemove) {
    clearStrikeFormatting(fragment);
    range.insertNode(fragment);
    const nextRange = document.createRange();
    nextRange.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  } else {
    const wrapper = document.createElement('span');
    wrapper.dataset.noteStrike = 'true';
    wrapper.style.textDecoration = 'line-through';
    wrapper.style.color = STRIKE_TEXT_COLOR;
    wrapper.appendChild(fragment);
    range.insertNode(wrapper);
    const nextRange = document.createRange();
    nextRange.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }
  return true;
}

function triggerSaveFeedback(button) {
  if (!button) return;
  button.classList.remove('is-saving');
  void button.offsetWidth;
  button.classList.add('is-saving');
  window.setTimeout(() => {
    button.classList.remove('is-saving');
  }, 520);
}

function blurEditableFocus() {
  const activeElement = document.activeElement;
  if (activeElement && typeof activeElement.blur === 'function') {
    activeElement.blur();
  }
  const selection = window.getSelection?.();
  selection?.removeAllRanges?.();
  savedEditorSelection = null;
}

function focusPopupShell() {
  if (typeof window.focus === 'function') {
    window.focus();
  }
  noteCard?.focus?.({ preventScroll: true });
}

function shouldHandleEditorHistoryShortcut() {
  return document.activeElement === noteContent || !!getSelectionRangeWithinEditor(noteContent);
}

function isHeaderInteractiveTarget(target) {
  return !!target?.closest?.('button, select, input, textarea, a, [contenteditable="true"]');
}

function enableWheelScroll(row) {
  if (!row) return;
  row.addEventListener('wheel', event => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const canScrollHorizontally = row.scrollWidth > row.clientWidth + 1;
    const canScrollVertically = row.scrollHeight > row.clientHeight + 1;
    if (!canScrollHorizontally && !canScrollVertically) return;
    event.preventDefault();
    if (canScrollHorizontally) {
      row.scrollLeft += delta;
      return;
    }
    row.scrollTop += delta;
  }, { passive: false });
}

function renderCollectionOptions(collections) {
  noteCollectionSelect.innerHTML = '';
  collections.forEach(collection => {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.name;
    if (collection.id === currentCollectionId) {
      option.selected = true;
    }
    noteCollectionSelect.appendChild(option);
  });
}

function getCurrentSnapshot() {
  return {
    collectionId: currentCollectionId,
    title: noteTitle.value.trim(),
    content: noteContent.innerHTML.trim(),
    plannedDate: currentPlannedDate,
    tags: normalizeTags(noteTags.value),
    attachments: cloneAttachments(attachments)
  };
}

function hasUnsavedChanges() {
  if (!originalSnapshot) return true;
  const snapshot = getCurrentSnapshot();
  return snapshot.collectionId !== originalSnapshot.collectionId
    || snapshot.title !== originalSnapshot.title
    || snapshot.content !== originalSnapshot.content
    || snapshot.plannedDate !== originalSnapshot.plannedDate
    || !sameList(snapshot.tags, originalSnapshot.tags)
    || !sameList(snapshot.attachments, originalSnapshot.attachments);
}

function setReadOnly(readonly) {
  currentReadOnly = readonly;
  noteContent.setAttribute('contenteditable', readonly ? 'false' : 'true');
  noteToolbar.classList.toggle('active', !readonly);
}

function stopActiveAudio() {
  if (currentAudioPlayer) {
    currentAudioPlayer.pause();
    currentAudioPlayer.currentTime = 0;
  }
  if (currentAudioButton) {
    currentAudioButton.classList.remove('active');
  }
  currentAudioPlayer = null;
  currentAudioButton = null;
}

async function playAudioAttachment(att, button) {
  const url = await resolveAssetUrl(att.path);
  if (currentAudioPlayer && currentAudioButton === button) {
    stopActiveAudio();
    return;
  }
  stopActiveAudio();
  const player = new Audio(url);
  currentAudioPlayer = player;
  currentAudioButton = button;
  button.classList.add('active');
  player.addEventListener('ended', () => {
    stopActiveAudio();
  }, { once: true });
  player.play();
}

async function openImageViewer(imageAttachments, startIndex) {
  api.invoke('app:show-image-viewer', {
    images: imageAttachments.map(item => ({
      path: item.path,
      remark: item.remark || ''
    })),
    index: startIndex
  });
}

function updateAttachmentRemark(path, remark) {
  if (!path) return;
  const target = attachments.find(item => item.type === 'image' && item.path === path);
  if (!target) return;
  target.remark = remark || '';
}

function unwrapElement(element) {
  const parent = element?.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function normalizeColorValue(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function hasActiveHighlight(editor) {
  const commandColor = normalizeColorValue(document.queryCommandValue('hiliteColor') || document.queryCommandValue('backColor'));
  if (commandColor === normalizeColorValue(HIGHLIGHT_COLOR) || commandColor === 'rgb(243,241,152)' || commandColor === 'rgba(243,241,152,1)') {
    return true;
  }
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  let node = selection.anchorNode;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const bg = normalizeColorValue(window.getComputedStyle(node).backgroundColor);
      if (bg === 'rgb(243,241,152)' || bg === 'rgba(243,241,152,1)') {
        return true;
      }
    }
    node = node.parentNode;
  }
  return false;
}

function cleanupTransparentHighlights(editor) {
  editor.querySelectorAll('span').forEach(span => {
    const bg = normalizeColorValue(span.style.backgroundColor || window.getComputedStyle(span).backgroundColor);
    const style = (span.getAttribute('style') || '').trim().toLowerCase();
    if (bg === 'transparent' || bg === 'rgba(0,0,0,0)') {
      if (!style || /^background-color:\s*(transparent|rgba\(0,\s*0,\s*0,\s*0\));?$/.test(style)) {
        unwrapElement(span);
      }
    }
  });
}

function toggleHighlight(editor) {
  const highlighted = hasActiveHighlight(editor);
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('hiliteColor', false, highlighted ? 'transparent' : HIGHLIGHT_COLOR);
  if (highlighted) {
    cleanupTransparentHighlights(editor);
  }
}

function syncRecordingPreview() {
  if (!recordingPreview) return;
  recordingPreview.duration = Math.max(0, Math.floor((Date.now() - recordStart) / 1000));
  renderAttachments();
}

function startRecordingPreview() {
  recordingPreview = { type: 'audio', duration: 0, isPending: true };
  noteRecordBtn.classList.add('active');
  renderAttachments();
  clearInterval(recordingTimer);
  recordingTimer = setInterval(syncRecordingPreview, 1000);
}

function stopRecordingPreview() {
  clearInterval(recordingTimer);
  recordingTimer = null;
  recordingPreview = null;
  noteRecordBtn.classList.remove('active');
}

function getPayloadKey(payload) {
  if (!payload) return '';
  const noteId = typeof payload === 'string' ? payload : payload.noteId || '';
  const mode = typeof payload === 'string' ? 'read' : payload.mode || 'read';
  const draftKey = typeof payload === 'object' && payload?.draftKey ? payload.draftKey : '';
  const collectionId = typeof payload === 'object' && payload?.collectionId ? payload.collectionId : '';
  const draft = typeof payload === 'object' && payload?.draft ? 'draft' : 'saved';
  return [noteId, mode, draftKey, collectionId, draft].join('|');
}

function preloadImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });
}

async function prepareAttachmentAssetUrls(list = []) {
  const nextCache = new Map();
  const imageAttachments = list.filter(item => item.type === 'image');
  await Promise.all(imageAttachments.map(async item => {
    const key = item.thumbnailPath || item.path;
    if (!key) return;
    const url = await resolveAssetUrl(key);
    nextCache.set(key, url);
    await preloadImage(url);
  }));
  attachmentUrlCache = nextCache;
}

function removeAttachmentAt(index) {
  attachments.splice(index, 1);
  stopActiveAudio();
  renderAttachments();
}

function moveAttachmentWithinType(fromIndex, toIndex, type) {
  if (fromIndex === toIndex) return;
  const typeIndexes = attachments
    .map((att, index) => ({ att, index }))
    .filter(item => item.att.type === type)
    .map(item => item.index);
  const sourceIndex = typeIndexes[fromIndex];
  const targetIndex = typeIndexes[toIndex];
  if (sourceIndex == null || targetIndex == null) return;
  const [moved] = attachments.splice(sourceIndex, 1);
  const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  attachments.splice(adjustedTarget, 0, moved);
  renderAttachments();
}

function createAttachmentDeleteButton(index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'attachment-delete-btn';
  button.textContent = '×';
  button.addEventListener('click', event => {
    event.stopPropagation();
    removeAttachmentAt(index);
  });
  return button;
}

function wireAttachmentDrag(wrapper, type, typeIndex) {
  wrapper.setAttribute('draggable', 'true');
  wrapper.addEventListener('dragstart', event => {
    dragAttachmentIndex = typeIndex;
    dragAttachmentType = type;
    wrapper.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  wrapper.addEventListener('dragend', () => {
    wrapper.classList.remove('dragging');
    dragAttachmentIndex = null;
    dragAttachmentType = null;
  });
  wrapper.addEventListener('dragover', event => {
    if (dragAttachmentType !== type) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  wrapper.addEventListener('drop', event => {
    if (dragAttachmentType !== type) return;
    event.preventDefault();
    moveAttachmentWithinType(dragAttachmentIndex, typeIndex, type);
  });
}

function renderAttachments() {
  noteAttachments.innerHTML = '';
  const imageAttachments = attachments.filter(att => att.type === 'image');
  const audioAttachments = attachments.filter(att => att.type === 'audio');

  if (imageAttachments.length) {
    const imageRow = document.createElement('div');
    imageRow.className = 'attachment-image-row';
    enableWheelScroll(imageRow);
    imageAttachments.forEach((att, index) => {
      const attachmentIndex = attachments.indexOf(att);
      const wrapper = document.createElement('div');
      wrapper.className = 'attachment-item';
      const thumbButton = document.createElement('button');
      thumbButton.type = 'button';
      thumbButton.className = 'attachment-thumb-btn';
      const img = document.createElement('img');
      img.className = 'attachment-thumb';
      const assetKey = att.thumbnailPath || att.path;
      const cachedUrl = attachmentUrlCache.get(assetKey);
      if (cachedUrl) {
        img.src = cachedUrl;
      } else {
        resolveAssetUrl(assetKey).then(url => {
          img.src = url;
        });
      }
      thumbButton.appendChild(img);
      thumbButton.addEventListener('click', () => {
        openImageViewer(imageAttachments, index);
      });
      wrapper.appendChild(thumbButton);
      wrapper.appendChild(createAttachmentDeleteButton(attachmentIndex));
      wireAttachmentDrag(wrapper, 'image', index);
      imageRow.appendChild(wrapper);
    });
    noteAttachments.appendChild(imageRow);
  }

  const audioItems = recordingPreview ? [recordingPreview, ...audioAttachments] : audioAttachments;
  if (audioItems.length) {
    const audioRow = document.createElement('div');
    audioRow.className = 'audio-strip';
    enableWheelScroll(audioRow);
    audioItems.forEach((att, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'attachment-item';
      const button = document.createElement('button');
      button.type = 'button';
      if (att.isPending) {
        button.className = 'audio-chip recording active';
        button.innerHTML = `<span class="audio-chip-label">\u5f55\u97f3\u4e2d</span><span class="audio-chip-time">${formatDuration(att.duration || 0)}</span>`;
        button.addEventListener('click', () => {
          if (!isRecording) return;
          isRecording = false;
          stopRecording();
        });
      } else {
        const attachmentIndex = attachments.indexOf(att);
        button.className = 'audio-chip';
        button.innerHTML = `<span class="audio-chip-label">\u5f55\u97f3</span><span class="audio-chip-time">${formatDuration(att.duration || 0)}</span>`;
        button.addEventListener('click', () => {
          playAudioAttachment(att, button);
        });
        wrapper.appendChild(createAttachmentDeleteButton(attachmentIndex));
        wireAttachmentDrag(wrapper, 'audio', recordingPreview ? index - 1 : index);
      }
      wrapper.appendChild(button);
      audioRow.appendChild(wrapper);
    });
    noteAttachments.appendChild(audioRow);
  }
}

async function loadNote(payload) {
  const payloadKey = getPayloadKey(payload);
  if (payloadKey && payloadKey === lastLoadedPayloadKey && noteBody && !noteBody.classList.contains('is-loading')) {
    return;
  }
  lastLoadedPayloadKey = payloadKey;
  const openToken = ++noteOpenToken;
  const loadingStartedAt = Date.now();
  setNoteBodyLoadingState(true);
  resetNoteViewForOpen();
  const noteId = typeof payload === 'string' ? payload : payload?.noteId;
  const mode = typeof payload === 'string' ? 'read' : payload?.mode || 'read';
  const draft = typeof payload === 'string' ? false : !!payload?.draft;
  const data = await api.invoke('data:get');
  const collections = data.collections || [];

  isDraft = draft;
  currentCollectionId = payload?.collectionId || currentCollectionId;

  if (draft) {
    currentNoteId = null;
    renderCollectionOptions(collections);
    currentPlannedDate = normalizePlannedDate(payload?.plannedDate);
    noteCalendarMonth = currentPlannedDate ? currentPlannedDate.slice(0, 7) : getMonthKey();
    renderPlannedDateTag();
    originalSnapshot = getCurrentSnapshot();
    setReadOnly(false);
    noteToolbar.classList.add('active');
    initializeEditorHistory();
    rememberEditorSelection();
    await waitForMinimumLoading(loadingStartedAt, 30);
    await flushRenderFrames(1);
    if (openToken !== noteOpenToken) return;
    setNoteBodyLoadingState(false);
    noteContent.focus();
    return;
  }

  const note = data.notes.find(item => item.id === noteId);
  if (!note) {
    setNoteBodyLoadingState(false);
    return;
  }
  currentNoteId = note.id;
  currentCollectionId = note.collectionId;
  renderCollectionOptions(collections);
  noteTitle.value = note.title || '';
  syncHeaderTitle();
  noteContent.innerHTML = normalizeStoredContentHtml(note.content || '');
  currentPlannedDate = normalizePlannedDate(note.plannedDate);
  noteCalendarMonth = currentPlannedDate ? currentPlannedDate.slice(0, 7) : getMonthKey();
  renderPlannedDateTag();
  noteTags.value = (note.tags || []).join(', ');
  attachments = cloneAttachments(note.attachments || []);
  await prepareAttachmentAssetUrls(attachments);
  renderAttachments();
  setReadOnly(mode !== 'edit');
  originalSnapshot = getCurrentSnapshot();
  initializeEditorHistory();
  rememberEditorSelection();
  await api.invoke('app:update-note-window-context', { noteId: currentNoteId });
  await waitForMinimumLoading(loadingStartedAt, 45);
  await flushRenderFrames(1);
  if (openToken !== noteOpenToken) return;
  setNoteBodyLoadingState(false);
  if (mode === 'edit') {
    noteContent.focus();
  }
}

async function saveCurrentNote() {
  const contentHtml = serializeEditorHtml(noteContent);
  const contentText = htmlToPlainText(contentHtml).trim();
  const rawTitle = noteTitle.value.trim();
  const titleSource = getFirstLineText(contentText);
  const title = rawTitle || titleSource.slice(0, 20) || '\u672a\u547d\u540d';
  const tags = normalizeTags(noteTags.value);
  if (!currentCollectionId) {
    const data = await api.invoke('data:get');
    currentCollectionId = data.collections?.find(item => item.isDefault)?.id || data.collections?.[0]?.id || null;
  }

  if (!rawTitle && !contentText && attachments.length === 0) {
    return null;
  }

  if (isDraft) {
    const created = await api.invoke('data:create-note', {
      collectionId: currentCollectionId,
      title,
      content: contentHtml,
      plannedDate: currentPlannedDate,
      attachments,
      tags
    });
    isDraft = false;
    currentNoteId = created.id;
    await api.invoke('app:update-note-window-context', { noteId: created.id });
    await loadNote({ noteId: created.id, mode: 'edit' });
    return created;
  }

  if (!currentNoteId) return null;
  if (!hasUnsavedChanges()) {
    return { id: currentNoteId, unchanged: true };
  }

  const updated = await api.invoke('data:update-note', {
    noteId: currentNoteId,
    patch: {
      collectionId: currentCollectionId,
      title,
      content: contentHtml,
      plannedDate: currentPlannedDate,
      tags,
      attachments
    }
  });
  originalSnapshot = getCurrentSnapshot();
  return updated;
}

async function handlePaste(event) {
  const imageBytes = api.readClipboardImage();
  if (imageBytes) {
    event.preventDefault();
    const savedImage = await api.invoke('data:save-image', { buffer: imageBytes, extension: 'png' });
    attachments.push({ type: 'image', ...savedImage });
    renderAttachments();
    return;
  }
  const plainText = event.clipboardData?.getData('text/plain');
  if (plainText) {
    event.preventDefault();
    insertPlainTextAtCursor(plainText);
  }
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const preferredMimeType = getPreferredAudioMimeType();
  recorder = preferredMimeType ? new MediaRecorder(stream, { mimeType: preferredMimeType }) : new MediaRecorder(stream);
  const chunks = [];
  recordStart = Date.now();
  startRecordingPreview();
  recorder.ondataavailable = event => chunks.push(event.data);
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const extension = recorder.mimeType.includes('ogg') ? 'ogg' : 'webm';
    const savedPath = await api.invoke('data:save-audio', { buffer, extension });
    const duration = Math.max(1, Math.round((Date.now() - recordStart) / 1000));
    stopRecordingPreview();
    attachments.push({ type: 'audio', path: savedPath, duration });
    renderAttachments();
    stream.getTracks().forEach(track => track.stop());
    recorder = null;
    isRecording = false;
  };
  recorder.start();
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

function stopResizeSession() {
  if (!resizeSession) return;
  window.removeEventListener('mousemove', handleResizeDrag);
  window.removeEventListener('mouseup', stopResizeSession);
  document.body.style.userSelect = '';
  resizeSession = null;
}

function handleResizeDrag(event) {
  if (!resizeSession) return;
  const nextHeight = resizeSession.startHeight + (event.screenY - resizeSession.startY);
  api.invoke('app:resize-note-window', {
    height: Math.max(524, nextHeight)
  }).catch(() => {});
}

pinBtn.addEventListener('click', () => {
  isPinned = !isPinned;
  pinBtn.classList.toggle('active', isPinned);
  api.invoke('app:set-note-pin', isPinned);
});

noteCollectionSelect.addEventListener('change', () => {
  currentCollectionId = noteCollectionSelect.value;
});

api.on('image-viewer:remark-updated', payload => {
  updateAttachmentRemark(payload?.path, payload?.remark);
});

noteTitle.addEventListener('input', () => {
  syncHeaderTitle();
});

closeNote.addEventListener('click', async () => {
  stopActiveAudio();
  api.invoke('app:hide-note');
});

saveNoteBtn.addEventListener('click', async () => {
  triggerSaveFeedback(saveNoteBtn);
  await saveCurrentNote();
});

noteContent.addEventListener('dblclick', () => {
  setReadOnly(false);
  initializeEditorHistory();
});

noteContent.addEventListener('dragstart', event => {
  event.preventDefault();
});

noteCard?.setAttribute('tabindex', '-1');

function handleHeaderFocusPointer(event) {
  if (event.button !== 0 || isHeaderInteractiveTarget(event.target)) return;
  blurEditableFocus();
  focusPopupShell();
}

noteHeaderFocusZone?.addEventListener('mousedown', handleHeaderFocusPointer);
noteHeaderFocusZone?.addEventListener('dblclick', handleHeaderFocusPointer);

noteHeader?.addEventListener('dblclick', event => {
  if (isHeaderInteractiveTarget(event.target)) return;
  blurEditableFocus();
  focusPopupShell();
});

noteContent.addEventListener('paste', handlePaste);
noteContent.addEventListener('input', () => {
  queueHistorySnapshot();
  rememberEditorSelection();
});

document.addEventListener('selectionchange', () => {
  const activeRange = getSelectionRangeWithinEditor(noteContent);
  if (!activeRange) return;
  savedEditorSelection = cloneEditorRange(activeRange);
});

noteRecordBtn.addEventListener('click', async () => {
  if (!isRecording) {
    isRecording = true;
    try {
      await startRecording();
    } catch (_error) {
      isRecording = false;
      stopRecordingPreview();
    }
  } else {
    isRecording = false;
    stopRecording();
  }
});

noteImageBtn.addEventListener('click', async () => {
  const result = await api.invoke('dialog:open-image');
  if (result.canceled || !result.filePaths.length) return;
  const filePath = result.filePaths[0];
  const buffer = api.readFileBuffer(filePath);
  const ext = api.extname(filePath).replace('.', '') || 'png';
  const savedImage = await api.invoke('data:save-image', { buffer, extension: ext });
  attachments.push({ type: 'image', ...savedImage, ext });
  renderAttachments();
});

noteHighlightBtn.addEventListener('mousedown', event => {
  event.preventDefault();
});

noteHighlightBtn.addEventListener('click', () => {
  applyTrackedEditorMutation(() => {
    toggleHighlight(noteContent);
    return true;
  });
});

noteBoldBtn.addEventListener('mousedown', event => {
  event.preventDefault();
});

noteBoldBtn.addEventListener('click', () => {
  applyTrackedEditorMutation(() => {
    document.execCommand('bold');
    return true;
  });
});

noteStrikeBtn?.addEventListener('mousedown', event => {
  event.preventDefault();
});

noteStrikeBtn?.addEventListener('click', () => {
  applyTrackedEditorMutation(() => toggleStrikeOnSelection(noteContent));
});

noteTagBtn?.addEventListener('click', () => {
  noteTags.focus();
});

noteCalendarBtn?.addEventListener('click', event => {
  event.stopPropagation();
  if (currentReadOnly) {
    setReadOnly(false);
  }
  if (!noteCalendarMonth) {
    noteCalendarMonth = currentPlannedDate ? currentPlannedDate.slice(0, 7) : getMonthKey();
  }
  setCalendarPopoverOpen(noteCalendarPopover.classList.contains('hidden'));
});

noteCalendarPrevBtn?.addEventListener('click', () => {
  noteCalendarMonth = shiftMonthKey(ensureNoteCalendarMonth(), -1);
  renderNoteCalendarGrid();
});

noteCalendarNextBtn?.addEventListener('click', () => {
  noteCalendarMonth = shiftMonthKey(ensureNoteCalendarMonth(), 1);
  renderNoteCalendarGrid();
});

noteCalendarMonthBtn?.addEventListener('click', () => {
  noteCalendarMonthInput.value = ensureNoteCalendarMonth();
  if (typeof noteCalendarMonthInput.showPicker === 'function') {
    noteCalendarMonthInput.showPicker();
  } else {
    noteCalendarMonthInput.click();
  }
});

noteCalendarMonthInput?.addEventListener('change', () => {
  if (!noteCalendarMonthInput.value) return;
  noteCalendarMonth = noteCalendarMonthInput.value;
  renderNoteCalendarGrid();
});

noteCalendarClearBtn?.addEventListener('click', () => {
  currentPlannedDate = '';
  renderPlannedDateTag();
  renderNoteCalendarGrid();
});

fontPlus.addEventListener('mousedown', event => {
  event.preventDefault();
});

fontPlus.addEventListener('click', () => {
  adjustSelectedFontSize(1);
});

fontMinus.addEventListener('mousedown', event => {
  event.preventDefault();
});

fontMinus.addEventListener('click', () => {
  adjustSelectedFontSize(-1);
});

noteResizeHandle?.addEventListener('mousedown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  resizeSession = {
    startY: event.screenY,
    startHeight: window.innerHeight
  };
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', handleResizeDrag);
  window.addEventListener('mouseup', stopResizeSession);
});

window.__prepareNoteOpen = prepareNoteOpenFrame;

api.on('note:prepare-open', () => {
  prepareNoteOpenFrame();
});

api.on('note:open', payload => {
  loadNote(payload);
});

api.on('data:updated', () => {
  if (currentNoteId && !isDraft && !hasUnsavedChanges()) {
    loadNote({ noteId: currentNoteId, mode: currentReadOnly ? 'read' : 'edit' });
  }
});

api.invoke('app:get-note-window-payload')
  .then(payload => {
    if (payload) {
      loadNote(payload);
    }
  })
  .catch(() => {});

window.addEventListener('wheel', event => {
  if (!qPressed) return;
  event.preventDefault();
  adjustPopupOpacity(event.deltaY < 0 ? 0.05 : -0.05);
}, { passive: false });

document.addEventListener('keydown', event => {
  if (event.code === 'KeyQ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    qPressed = true;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === 'z' && shouldHandleEditorHistoryShortcut()) {
      event.preventDefault();
      if (event.shiftKey) {
        redoEditorChange();
      } else {
        undoEditorChange();
      }
      return;
    }
    if (key === 'y' && shouldHandleEditorHistoryShortcut()) {
      event.preventDefault();
      redoEditorChange();
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    triggerSaveFeedback(saveNoteBtn);
    saveCurrentNote();
    return;
  }
  if (event.key === 'Escape') {
    stopActiveAudio();
    api.invoke('app:hide-note');
  }
});

document.addEventListener('keyup', event => {
  if (event.code === 'KeyQ') {
    qPressed = false;
  }
});

document.addEventListener('mousedown', event => {
  if (!noteCalendarPopover || noteCalendarPopover.classList.contains('hidden')) return;
  if (noteCalendarPopover.contains(event.target) || noteCalendarBtn?.contains(event.target)) return;
  setCalendarPopoverOpen(false);
});

window.addEventListener('blur', () => {
  qPressed = false;
  noteCard?.classList.remove('is-adjusting-opacity');
  window.clearTimeout(opacityIndicatorTimer);
});
