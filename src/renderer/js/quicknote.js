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

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function getPreferredAudioMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ];
  return candidates.find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) || '';
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

async function resolveAssetUrl(relativePath) {
  return api.resolveAssetUrl(relativePath);
}

const quicknoteShell = document.getElementById('quicknoteShell');
const quicknoteHeader = document.querySelector('.quicknote-header');
const quicknoteHeaderFocusZone = document.getElementById('quicknoteHeaderFocusZone');
const collectionSelect = document.getElementById('collectionSelect');
const noteSelect = document.getElementById('noteSelect');
const titleInput = document.getElementById('titleInput');
const contentEditor = document.getElementById('contentEditor');
const attachmentRow = document.getElementById('attachmentRow');
const closeQuicknote = document.getElementById('closeQuicknote');
const recordBtn = document.getElementById('recordBtn');
const highlightBtn = document.getElementById('highlightBtn');
const boldBtn = document.getElementById('boldBtn');
const saveQuicknoteBtn = document.getElementById('saveQuicknoteBtn');
const expandQuicknoteBtn = document.getElementById('expandQuicknoteBtn');
const quicknoteCard = document.querySelector('.quicknote-card');
const closeQuicknoteIcon = document.getElementById('closeQuicknoteIcon');

let collections = [];
let notes = [];
let attachments = [];
let isRecording = false;
let recorder = null;
let recordStart = 0;
let currentAudioPlayer = null;
let currentAudioButton = null;
let currentMode = 'mini';
let dragAttachmentIndex = null;
let dragAttachmentType = null;
let qPressed = false;
let popupOpacity = 1;
let recordingPreview = null;
let recordingTimer = null;
const HIGHLIGHT_COLOR = '#F3F198';
let opacityIndicatorTimer = null;
let savedQuicknoteSession = null;
let quicknoteSaveChain = Promise.resolve(false);

function cloneQuicknoteAttachments(list = []) {
  return list.map(item => ({ ...item }));
}

function getSaveSnapshot({ collectionId, noteId, title, content, attachments: attachmentList }) {
  return {
    collectionId,
    noteId,
    title,
    content,
    attachments: cloneQuicknoteAttachments(attachmentList)
  };
}

function isSameSaveSnapshot(left, right) {
  return !!left
    && !!right
    && left.collectionId === right.collectionId
    && left.noteId === right.noteId
    && left.title === right.title
    && left.content === right.content
    && JSON.stringify(left.attachments || []) === JSON.stringify(right.attachments || []);
}

function clearSavedQuicknoteSession() {
  savedQuicknoteSession = null;
}

function buildAppendedContent(baseContent, incomingContent) {
  const previousContent = String(baseContent || '').trim();
  const nextContent = String(incomingContent || '').trim();
  const separator = previousContent && nextContent ? '<br>' : '';
  return `${previousContent}${separator}${nextContent}`;
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
  if (currentAudioButton === button && currentAudioPlayer) {
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

function getRealCollections() {
  return collections.filter(col => col && col.id && col.name !== '\u5168\u90e8\u7b14\u8bb0' && !col.isPrivate);
}

function blurEditableFocus() {
  const activeElement = document.activeElement;
  if (activeElement && typeof activeElement.blur === 'function') {
    activeElement.blur();
  }
  const selection = window.getSelection?.();
  selection?.removeAllRanges?.();
}

function focusPopupShell() {
  if (typeof window.focus === 'function') {
    window.focus();
  }
  quicknoteCard?.focus?.({ preventScroll: true });
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

function getDefaultCollectionId(preferredId) {
  const realCollections = getRealCollections();
  if (preferredId && realCollections.some(col => col.id === preferredId)) {
    return preferredId;
  }
  const unfiled = realCollections.find(col => col.name === '\u672a\u5f52\u6863');
  return unfiled?.id || realCollections[0]?.id || '';
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
  recordBtn.classList.add('active');
  renderAttachments();
  clearInterval(recordingTimer);
  recordingTimer = setInterval(syncRecordingPreview, 1000);
}

function stopRecordingPreview() {
  clearInterval(recordingTimer);
  recordingTimer = null;
  recordingPreview = null;
  recordBtn.classList.remove('active');
}

function syncCompactSelectWidth(selectEl) {
  if (!selectEl) return;
  const option = selectEl.selectedOptions?.[0];
  const text = option?.textContent || '';
  const styles = window.getComputedStyle(selectEl);
  const probe = document.createElement('span');
  probe.textContent = text;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.whiteSpace = 'nowrap';
  probe.style.font = styles.font;
  probe.style.letterSpacing = styles.letterSpacing;
  document.body.appendChild(probe);
  const width = Math.ceil(probe.getBoundingClientRect().width) + 14;
  document.body.removeChild(probe);
  selectEl.style.width = `${Math.max(32, width)}px`;
}

function syncHeaderSelectWidths() {
  syncCompactSelectWidth(collectionSelect);
  syncCompactSelectWidth(noteSelect);
}

function applyPopupOpacity() {
  if (!quicknoteCard) return;
  quicknoteCard.style.opacity = popupOpacity.toFixed(2);
}

function flashOpacityIndicator() {
  if (!quicknoteCard) return;
  quicknoteCard.classList.add('is-adjusting-opacity');
  window.clearTimeout(opacityIndicatorTimer);
  opacityIndicatorTimer = window.setTimeout(() => {
    quicknoteCard.classList.remove('is-adjusting-opacity');
  }, 260);
}

function adjustPopupOpacity(delta) {
  popupOpacity = Math.min(1, Math.max(0.2, popupOpacity + delta));
  applyPopupOpacity();
  flashOpacityIndicator();
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

async function loadData(preferredCollectionId) {
  const data = await api.invoke('data:get');
  const config = await api.invoke('data:get-config');
  collections = data.collections || [];
  notes = data.notes || [];
  const selectedId = getDefaultCollectionId(preferredCollectionId || config.lastCollectionId);
  renderCollections(selectedId);
}

function renderCollections(selectedId) {
  const realCollections = getRealCollections();
  const resolvedId = getDefaultCollectionId(selectedId);
  collectionSelect.innerHTML = '';
  realCollections.forEach(col => {
    const option = document.createElement('option');
    option.value = col.id;
    option.textContent = col.name;
    if (col.id === resolvedId) option.selected = true;
    collectionSelect.appendChild(option);
  });
  renderNotes();
  syncHeaderSelectWidths();
}

function renderNotes() {
  noteSelect.innerHTML = '';
  const newOption = document.createElement('option');
  newOption.value = 'new';
  newOption.textContent = '\u65b0\u5efa\u7b14\u8bb0';
  noteSelect.appendChild(newOption);
  const selectedCollection = collectionSelect.value;
  notes
    .filter(note => note.collectionId === selectedCollection)
    .forEach(note => {
      const option = document.createElement('option');
      option.value = note.id;
      option.textContent = note.title || '\u672a\u547d\u540d';
      noteSelect.appendChild(option);
    });
  syncHeaderSelectWidths();
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
  attachmentRow.innerHTML = '';
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
      resolveAssetUrl(att.thumbnailPath || att.path).then(url => {
        img.src = url;
      });
      thumbButton.appendChild(img);
      thumbButton.addEventListener('click', () => {
        openImageViewer(imageAttachments, index);
      });
      wrapper.appendChild(thumbButton);
      wrapper.appendChild(createAttachmentDeleteButton(attachmentIndex));
      wireAttachmentDrag(wrapper, 'image', index);
      imageRow.appendChild(wrapper);
    });
    attachmentRow.appendChild(imageRow);
  }

  const audioItems = recordingPreview ? [recordingPreview, ...audioAttachments] : audioAttachments;
  if (audioItems.length) {
    const audioRow = document.createElement('div');
    audioRow.className = 'audio-strip';
    enableWheelScroll(audioRow);
    audioItems.forEach((att, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'attachment-item';
      const chip = document.createElement('button');
      chip.type = 'button';
      if (att.isPending) {
        chip.className = 'audio-chip recording active';
        chip.innerHTML = `<span class="audio-chip-label">\u5f55\u97f3\u4e2d</span><span class="audio-chip-time">${formatDuration(att.duration || 0)}</span>`;
        chip.addEventListener('click', () => {
          if (!isRecording) return;
          isRecording = false;
          stopRecording();
        });
      } else {
        const attachmentIndex = attachments.indexOf(att);
        chip.className = 'audio-chip';
        chip.innerHTML = `<span class="audio-chip-label">\u5f55\u97f3</span><span class="audio-chip-time">${formatDuration(att.duration || 0)}</span>`;
        chip.addEventListener('click', () => {
          playAudioAttachment(att, chip);
        });
        wrapper.appendChild(createAttachmentDeleteButton(attachmentIndex));
        wireAttachmentDrag(wrapper, 'audio', recordingPreview ? index - 1 : index);
      }
      wrapper.appendChild(chip);
      audioRow.appendChild(wrapper);
    });
    attachmentRow.appendChild(audioRow);
  }
}

function resetForm({ preserveCollection = true } = {}) {
  clearSavedQuicknoteSession();
  const currentCollectionId = preserveCollection ? collectionSelect.value : getDefaultCollectionId();
  contentEditor.innerHTML = '';
  titleInput.value = '';
  attachments = [];
  noteSelect.value = 'new';
  stopActiveAudio();
  renderAttachments();
  if (preserveCollection && currentCollectionId) {
    collectionSelect.value = currentCollectionId;
    renderNotes();
  }
}

function setMode(mode) {
  currentMode = mode;
  quicknoteShell.classList.toggle('mini', mode === 'mini');
  quicknoteShell.classList.toggle('expanded', mode === 'expanded');
  saveQuicknoteBtn.innerHTML = '<img src="./assets/icons/save.svg" alt="" />';
  if (closeQuicknoteIcon) {
    closeQuicknoteIcon.src = mode === 'mini' ? './assets/icons/close-mini.svg' : './assets/icons/close.svg';
  }
}

function toggleMode(forceMode) {
  setMode(forceMode || (currentMode === 'mini' ? 'expanded' : 'mini'));
  requestAnimationFrame(() => {
    contentEditor.focus();
  });
}

function getEditorText() {
  return contentEditor.innerText.replace(/\u00a0/g, ' ').trim();
}

function getFirstLineText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')[0]
    .trim();
}

function getEditorHtml() {
  const html = serializeEditorHtml(contentEditor);
  if (html === '<br>' || html === '<div><br></div>') return '';
  return html;
}

function setEditorText(text) {
  contentEditor.innerHTML = text ? textToHtml(text) : '';
}

function getVisualLineCount() {
  const styles = window.getComputedStyle(contentEditor);
  const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.5 || 20;
  const rawHeight = contentEditor.scrollHeight - parseFloat(styles.paddingTop || '0') - parseFloat(styles.paddingBottom || '0');
  return Math.max(1, Math.round(rawHeight / lineHeight));
}

function maybeAutoExpand() {
  if (currentMode !== 'mini') return;
  if (getVisualLineCount() > 2) {
    setMode('expanded');
  }
}

async function handlePaste(event) {
  const imageBytes = api.readClipboardImage();
  if (imageBytes) {
    event.preventDefault();
    const savedImage = await api.invoke('data:save-image', { buffer: imageBytes, extension: 'png' });
    attachments.push({ type: 'image', ...savedImage });
    if (currentMode === 'mini') {
      setMode('expanded');
    }
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

async function saveNote() {
  const contentHtml = getEditorHtml();
  const contentText = getEditorText();
  const rawTitle = titleInput.value.trim();
  const titleSource = getFirstLineText(contentText);
  const title = rawTitle || titleSource.slice(0, 20) || '\u672a\u547d\u540d';
  const collectionId = getDefaultCollectionId(collectionSelect.value);
  const noteId = noteSelect.value;

  if (!rawTitle && !contentText && attachments.length === 0) return false;

  const snapshot = getSaveSnapshot({
    collectionId,
    noteId,
    title,
    content: contentHtml,
    attachments
  });

  if (isSameSaveSnapshot(savedQuicknoteSession?.snapshot, snapshot)) {
    contentEditor.focus();
    return true;
  }

  if (savedQuicknoteSession?.type === 'created' && savedQuicknoteSession.noteId) {
    await api.invoke('data:update-note', {
      noteId: savedQuicknoteSession.noteId,
      patch: {
        collectionId,
        title,
        content: contentHtml,
        attachments: cloneQuicknoteAttachments(attachments),
        tags: []
      }
    });
    savedQuicknoteSession.snapshot = snapshot;
  } else if (noteId === 'new') {
    const created = await api.invoke('data:create-note', {
      collectionId,
      title,
      content: contentHtml,
      attachments,
      tags: []
    });
    savedQuicknoteSession = {
      type: 'created',
      noteId: created?.id || '',
      snapshot
    };
  } else {
    let baseContent = '';
    let baseAttachments = [];
    if (
      savedQuicknoteSession?.type === 'append'
      && savedQuicknoteSession.noteId === noteId
      && savedQuicknoteSession.collectionId === collectionId
    ) {
      baseContent = savedQuicknoteSession.baseContent;
      baseAttachments = cloneQuicknoteAttachments(savedQuicknoteSession.baseAttachments || []);
    } else {
      const baseNote = notes.find(note => note.id === noteId);
      baseContent = baseNote?.content || '';
      baseAttachments = cloneQuicknoteAttachments(baseNote?.attachments || []);
    }
    await api.invoke('data:update-note', {
      noteId,
      patch: {
        content: buildAppendedContent(baseContent, contentHtml),
        attachments: [...baseAttachments, ...cloneQuicknoteAttachments(attachments)]
      }
    });
    savedQuicknoteSession = {
      type: 'append',
      noteId,
      collectionId,
      baseContent,
      baseAttachments,
      snapshot
    };
  }

  const config = await api.invoke('data:get-config');
  await api.invoke('data:save-config', {
    ...config,
    lastCollectionId: collectionId
  });

  contentEditor.focus();
  return true;
}

function saveCurrentQuicknote() {
  const shouldCloseAfterSave = currentMode === 'mini';
  quicknoteSaveChain = quicknoteSaveChain
    .catch(() => false)
    .then(async () => {
      const saved = await saveNote();
      if (saved && shouldCloseAfterSave) {
        resetForm();
        setMode('mini');
        await api.invoke('app:hide-quicknote');
      }
      return saved;
    });
  return quicknoteSaveChain;
}

function applyShowPayload(payload = {}) {
  resetForm({ preserveCollection: true });
  setMode('mini');
  noteSelect.value = 'new';
  if (payload.collectionId) {
    const nextCollectionId = getDefaultCollectionId(payload.collectionId);
    if (nextCollectionId) {
      collectionSelect.value = nextCollectionId;
      renderNotes();
    }
  }
  if (payload.prefillText) {
    setEditorText(payload.prefillText);
    if ((payload.prefillText || '').length > 20 || payload.forceExpanded) {
      setMode('expanded');
    } else {
      requestAnimationFrame(() => {
        maybeAutoExpand();
      });
    }
  }
  contentEditor.focus();
}

document.addEventListener('paste', handlePaste);

window.addEventListener('wheel', event => {
  if (!qPressed) return;
  event.preventDefault();
  adjustPopupOpacity(event.deltaY < 0 ? 0.05 : -0.05);
}, { passive: false });

collectionSelect.addEventListener('change', () => {
  clearSavedQuicknoteSession();
  renderNotes();
  syncCompactSelectWidth(collectionSelect);
});

noteSelect.addEventListener('change', () => {
  clearSavedQuicknoteSession();
  syncCompactSelectWidth(noteSelect);
});

closeQuicknote.addEventListener('click', () => {
  resetForm();
  setMode('mini');
  api.invoke('app:hide-quicknote');
});

api.on('image-viewer:remark-updated', payload => {
  updateAttachmentRemark(payload?.path, payload?.remark);
});

contentEditor.addEventListener('input', () => {
  requestAnimationFrame(() => {
    maybeAutoExpand();
  });
});

contentEditor.addEventListener('keydown', async event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    event.stopPropagation();
    triggerSaveFeedback(saveQuicknoteBtn);
    await saveCurrentQuicknote();
    return;
  }
});

contentEditor.addEventListener('dragstart', event => {
  event.preventDefault();
});

quicknoteCard?.setAttribute('tabindex', '-1');

function handleHeaderFocusPointer(event) {
  if (event.button !== 0 || isHeaderInteractiveTarget(event.target)) return;
  blurEditableFocus();
  focusPopupShell();
}

quicknoteHeaderFocusZone?.addEventListener('mousedown', handleHeaderFocusPointer);
quicknoteHeaderFocusZone?.addEventListener('dblclick', handleHeaderFocusPointer);

quicknoteHeader?.addEventListener('dblclick', event => {
  if (isHeaderInteractiveTarget(event.target)) return;
  blurEditableFocus();
  focusPopupShell();
});

document.addEventListener('keydown', async event => {
  if (event.code === 'KeyQ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    qPressed = true;
  }
  if (event.key === 'Escape') {
    resetForm();
    setMode('mini');
    api.invoke('app:hide-quicknote');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    triggerSaveFeedback(saveQuicknoteBtn);
    await saveCurrentQuicknote();
  }
});

document.addEventListener('keyup', event => {
  if (event.code === 'KeyQ') {
    qPressed = false;
  }
});

window.addEventListener('blur', () => {
  qPressed = false;
  quicknoteCard?.classList.remove('is-adjusting-opacity');
  window.clearTimeout(opacityIndicatorTimer);
});

expandQuicknoteBtn.addEventListener('click', () => {
  toggleMode();
});

recordBtn.addEventListener('click', async () => {
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

highlightBtn.addEventListener('click', () => {
  toggleHighlight(contentEditor);
});

boldBtn.addEventListener('click', () => {
  document.execCommand('bold');
});

saveQuicknoteBtn?.addEventListener('click', async () => {
  triggerSaveFeedback(saveQuicknoteBtn);
  await saveCurrentQuicknote();
});

api.on('data:updated', () => loadData(collectionSelect.value));
api.on('quicknote:show', async payload => {
  await loadData(payload?.collectionId);
  applyShowPayload(payload || {});
});

loadData().then(() => {
  setMode('mini');
});
