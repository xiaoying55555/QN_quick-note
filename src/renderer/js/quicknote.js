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

async function resolveAssetUrl(relativePath) {
  return api.resolveAssetUrl(relativePath);
}

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

let collections = [];
let notes = [];
let attachments = [];
let isRecording = false;
let recorder = null;
let recordStart = 0;
let currentAudioPlayer = null;
let currentAudioButton = null;

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
  await api.invoke('app:show-image-viewer', {
    images: imageAttachments.map(item => item.path),
    index: startIndex
  });
}

async function loadData() {
  const data = await api.invoke('data:get');
  const config = await api.invoke('data:get-config');
  collections = data.collections || [];
  notes = data.notes || [];
  renderCollections(config.lastCollectionId || collections[0]?.id);
}

function renderCollections(selectedId) {
  collectionSelect.innerHTML = '';
  collections.forEach(col => {
    const option = document.createElement('option');
    option.value = col.id;
    option.textContent = col.name;
    if (col.id === selectedId) option.selected = true;
    collectionSelect.appendChild(option);
  });
  renderNotes();
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
}

function renderAttachments() {
  attachmentRow.innerHTML = '';
  const imageAttachments = attachments.filter(att => att.type === 'image');
  const audioAttachments = attachments.filter(att => att.type === 'audio');

  if (imageAttachments.length) {
    const imageRow = document.createElement('div');
    imageRow.className = 'attachment-image-row';
    imageAttachments.forEach((att, index) => {
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
      imageRow.appendChild(thumbButton);
    });
    attachmentRow.appendChild(imageRow);
  }

  if (audioAttachments.length) {
    const audioRow = document.createElement('div');
    audioRow.className = 'audio-strip';
    audioAttachments.forEach(att => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'audio-chip';
      chip.innerHTML = `<span class="audio-chip-label">\u5f55\u97f3</span><span class="audio-chip-time">${formatDuration(att.duration || 0)}</span>`;
      chip.addEventListener('click', () => {
        playAudioAttachment(att, chip);
      });
      audioRow.appendChild(chip);
    });
    attachmentRow.appendChild(audioRow);
  }
}

function resetForm() {
  contentEditor.innerHTML = '';
  titleInput.value = '';
  attachments = [];
  noteSelect.value = 'new';
  stopActiveAudio();
  renderAttachments();
}

async function handlePaste(event) {
  const imageBytes = api.readClipboardImage();
  if (!imageBytes) return;
  event.preventDefault();
  const savedPath = await api.invoke('data:save-image', imageBytes);
  attachments.push({ type: 'image', path: savedPath });
  renderAttachments();
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

async function saveNote() {
  const contentHtml = contentEditor.innerHTML.trim();
  const contentText = stripHtml(contentHtml).trim();
  const rawTitle = titleInput.value.trim();
  const title = rawTitle || contentText.slice(0, 20) || '\u672a\u547d\u540d';
  const collectionId = collectionSelect.value;
  const noteId = noteSelect.value;

  if (!rawTitle && !contentText && attachments.length === 0) return;

  if (noteId === 'new') {
    await api.invoke('data:create-note', {
      collectionId,
      title,
      content: contentHtml,
      attachments,
      tags: []
    });
  } else {
    await api.invoke('data:append-note', {
      noteId,
      content: contentHtml,
      attachments
    });
  }

  const config = await api.invoke('data:get-config');
  await api.invoke('data:save-config', {
    ...config,
    lastCollectionId: collectionId
  });

  resetForm();
}

document.addEventListener('paste', handlePaste);

collectionSelect.addEventListener('change', () => {
  renderNotes();
});

closeQuicknote.addEventListener('click', () => {
  resetForm();
  api.invoke('app:hide-quicknote');
});

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveNote();
    return;
  }
  if (event.key === 'Escape') {
    resetForm();
    api.invoke('app:hide-quicknote');
  }
  if (event.key === 'Enter' && event.ctrlKey) {
    saveNote();
    api.invoke('app:hide-quicknote');
  }
});

recordBtn.addEventListener('click', async () => {
  if (!isRecording) {
    isRecording = true;
    await startRecording();
  } else {
    isRecording = false;
    stopRecording();
  }
});

highlightBtn.addEventListener('click', () => {
  document.execCommand('hiliteColor', false, '#F3F198');
});

boldBtn.addEventListener('click', () => {
  document.execCommand('bold');
});

saveQuicknoteBtn?.addEventListener('click', async () => {
  await saveNote();
  api.invoke('app:hide-quicknote');
});

api.on('data:updated', () => loadData());
api.on('quicknote:show', () => {
  noteSelect.value = 'new';
});

loadData();
