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

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function resolveAssetUrl(relativePath) {
  return api.resolveAssetUrl(relativePath);
}

const pinBtn = document.getElementById('pinBtn');
const closeNote = document.getElementById('closeNote');
const noteCollectionSelect = document.getElementById('noteCollectionSelect');
const noteHeaderTitle = document.getElementById('noteHeaderTitle');
const noteTitle = document.getElementById('noteTitle');
const noteAttachments = document.getElementById('noteAttachments');
const noteToolbar = document.getElementById('noteToolbar');
const noteContent = document.getElementById('noteContent');
const noteTags = document.getElementById('noteTags');
const noteStatus = document.getElementById('noteStatus');
const saveNoteBtn = document.getElementById('saveNoteBtn');
const noteRecordBtn = document.getElementById('noteRecordBtn');
const noteImageBtn = document.getElementById('noteImageBtn');
const noteHighlightBtn = document.getElementById('noteHighlightBtn');
const noteBoldBtn = document.getElementById('noteBoldBtn');
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
let fontSize = 13;
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

function getDisplayTitle(value) {
  return String(value || '').trim() || '\u65b0\u5efa\u7b14\u8bb0';
}

function syncHeaderTitle() {
  noteHeaderTitle.textContent = getDisplayTitle(noteTitle.value);
}

function applyPopupOpacity() {
  if (!noteCard) return;
  noteCard.style.opacity = popupOpacity.toFixed(2);
}

function adjustPopupOpacity(delta) {
  popupOpacity = Math.min(1, Math.max(0.2, popupOpacity + delta));
  applyPopupOpacity();
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
    || !sameList(snapshot.tags, originalSnapshot.tags)
    || !sameList(snapshot.attachments, originalSnapshot.attachments);
}

function setReadOnly(readonly) {
  currentReadOnly = readonly;
  noteContent.setAttribute('contenteditable', readonly ? 'false' : 'true');
  noteToolbar.classList.toggle('active', !readonly);
  noteStatus.textContent = readonly
    ? '\u53ea\u8bfb\u6a21\u5f0f\uff0c\u53cc\u51fb\u6b63\u6587\u8fdb\u5165\u7f16\u8f91'
    : '\u7f16\u8f91\u6a21\u5f0f';
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
  await api.invoke('app:show-image-viewer', {
    images: imageAttachments.map(item => item.path),
    index: startIndex
  });
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
    imageAttachments.forEach((att, index) => {
      const attachmentIndex = attachments.indexOf(att);
      const wrapper = document.createElement('div');
      wrapper.className = 'attachment-item';
      const thumbButton = document.createElement('button');
      thumbButton.type = 'button';
      thumbButton.className = 'attachment-thumb-btn';
      const img = document.createElement('img');
      img.className = 'attachment-thumb';
      resolveAssetUrl(att.path).then(url => {
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
    noteAttachments.appendChild(imageRow);
  }

  if (audioAttachments.length) {
    const audioRow = document.createElement('div');
    audioRow.className = 'audio-strip';
    audioAttachments.forEach((att, index) => {
      const attachmentIndex = attachments.indexOf(att);
      const wrapper = document.createElement('div');
      wrapper.className = 'attachment-item';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'audio-chip';
      button.innerHTML = `<span class="audio-chip-label">\u5f55\u97f3</span><span class="audio-chip-time">${formatDuration(att.duration || 0)}</span>`;
      button.addEventListener('click', () => {
        playAudioAttachment(att, button);
      });
      wrapper.appendChild(button);
      wrapper.appendChild(createAttachmentDeleteButton(attachmentIndex));
      wireAttachmentDrag(wrapper, 'audio', index);
      audioRow.appendChild(wrapper);
    });
    noteAttachments.appendChild(audioRow);
  }
}

async function loadNote(payload) {
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
    noteTitle.value = '';
    syncHeaderTitle();
    noteContent.innerHTML = '';
    noteTags.value = '';
    attachments = [];
    originalSnapshot = getCurrentSnapshot();
    renderAttachments();
    setReadOnly(false);
    noteToolbar.classList.add('active');
    noteContent.focus();
    return;
  }

  const note = data.notes.find(item => item.id === noteId);
  if (!note) return;
  currentNoteId = note.id;
  currentCollectionId = note.collectionId;
  renderCollectionOptions(collections);
  noteTitle.value = note.title || '';
  syncHeaderTitle();
  noteContent.innerHTML = note.content || '';
  noteTags.value = (note.tags || []).join(', ');
  attachments = cloneAttachments(note.attachments || []);
  renderAttachments();
  setReadOnly(mode !== 'edit');
  originalSnapshot = getCurrentSnapshot();
  await api.invoke('app:update-note-window-context', { noteId: currentNoteId });
  if (mode === 'edit') {
    noteContent.focus();
  }
}

async function saveCurrentNote() {
  const contentHtml = noteContent.innerHTML.trim();
  const contentText = stripHtml(contentHtml).trim();
  const rawTitle = noteTitle.value.trim();
  const title = rawTitle || contentText.slice(0, 20) || '\u672a\u547d\u540d';
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
    const savedPath = await api.invoke('data:save-image', imageBytes);
    attachments.push({ type: 'image', path: savedPath });
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
  recorder = new MediaRecorder(stream);
  const chunks = [];
  recordStart = Date.now();
  recorder.ondataavailable = event => chunks.push(event.data);
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const extension = recorder.mimeType.includes('ogg') ? 'ogg' : 'webm';
    const savedPath = await api.invoke('data:save-audio', { buffer, extension });
    const duration = Math.max(1, Math.round((Date.now() - recordStart) / 1000));
    attachments.push({ type: 'audio', path: savedPath, duration });
    renderAttachments();
    stream.getTracks().forEach(track => track.stop());
  };
  recorder.start();
}

function stopRecording() {
  if (recorder) recorder.stop();
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

noteTitle.addEventListener('input', () => {
  syncHeaderTitle();
});

closeNote.addEventListener('click', async () => {
  const result = await saveCurrentNote();
  if (isDraft && result) {
    stopActiveAudio();
    api.invoke('app:hide-note');
    return;
  }
  stopActiveAudio();
  api.invoke('app:hide-note');
});

saveNoteBtn.addEventListener('click', async () => {
  await saveCurrentNote();
});

noteContent.addEventListener('dblclick', () => {
  setReadOnly(false);
});

noteContent.addEventListener('paste', handlePaste);

noteRecordBtn.addEventListener('click', async () => {
  if (!isRecording) {
    isRecording = true;
    await startRecording();
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
  const savedPath = await api.invoke('data:save-image', buffer);
  attachments.push({ type: 'image', path: savedPath, ext });
  renderAttachments();
});

noteHighlightBtn.addEventListener('click', () => {
  document.execCommand('hiliteColor', false, '#F3F198');
});

noteBoldBtn.addEventListener('click', () => {
  document.execCommand('bold');
});

noteTagBtn.addEventListener('click', () => {
  noteTags.focus();
});

fontPlus.addEventListener('click', () => {
  fontSize = Math.min(fontSize + 1, 20);
  noteContent.style.setProperty('--content-font-size', `${fontSize}px`);
});

fontMinus.addEventListener('click', () => {
  fontSize = Math.max(fontSize - 1, 11);
  noteContent.style.setProperty('--content-font-size', `${fontSize}px`);
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
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

window.addEventListener('blur', () => {
  qPressed = false;
});
