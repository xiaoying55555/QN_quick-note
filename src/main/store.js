const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getDataDir() {
  return path.join(app.getPath('documents'), 'QuickNote');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyDir(sourceDir, targetDir) {
  ensureDir(targetDir);
  if (!fs.existsSync(sourceDir)) return;
  fs.readdirSync(sourceDir, { withFileTypes: true }).forEach(entry => {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
      return;
    }
    fs.copyFileSync(sourcePath, targetPath);
  });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function ensureStore() {
  const dataDir = getDataDir();
  const assetsDir = path.join(dataDir, 'assets');
  ensureDir(dataDir);
  ensureDir(assetsDir);

  const dataPath = path.join(dataDir, 'data.json');
  const configPath = path.join(dataDir, 'config.json');

  const now = new Date().toISOString();
  let data = readJson(dataPath, null);
  if (!data) {
    const defaultCollectionId = crypto.randomUUID();
    data = {
      collections: [
        {
          id: defaultCollectionId,
          name: '未归档',
          isDefault: true,
          isPrivate: false,
          createdAt: now
        }
      ],
      notes: []
    };
    writeJson(dataPath, data);

    const config = {
      shortcut: 'Ctrl+Shift+N',
      dataPath: dataDir,
      sortMode: 'updatedAt',
      lastCollectionId: defaultCollectionId,
      theme: 'light'
    };
    writeJson(configPath, config);
  } else {
    if (!Array.isArray(data.collections) || data.collections.length === 0) {
      const defaultCollectionId = crypto.randomUUID();
      data.collections = [
        {
          id: defaultCollectionId,
          name: '未归档',
          isDefault: true,
          isPrivate: false,
          createdAt: now
        }
      ];
      if (!Array.isArray(data.notes)) {
        data.notes = [];
      }
      writeJson(dataPath, data);
    } else {
      const defaultCollection = data.collections.find(collection => collection.isDefault) || data.collections[0];
      if (defaultCollection && defaultCollection.name !== '未归档') {
        defaultCollection.name = '未归档';
        defaultCollection.isDefault = true;
        writeJson(dataPath, data);
      }
    }
    if (!fs.existsSync(configPath)) {
      const config = {
        shortcut: 'Ctrl+Shift+N',
        dataPath: dataDir,
        sortMode: 'updatedAt',
        lastCollectionId: data.collections[0]?.id || '',
        theme: 'light'
      };
      writeJson(configPath, config);
    }
  }

  return { dataDir, dataPath, configPath, assetsDir };
}

function getDataPaths() {
  return ensureStore();
}

function getData() {
  const { dataPath } = ensureStore();
  return readJson(dataPath, { collections: [], notes: [] });
}

function saveData(data) {
  const { dataPath } = ensureStore();
  writeJson(dataPath, data);
  return data;
}

function createCollection({ name }) {
  const data = getData();
  const now = new Date().toISOString();
  const collection = {
    id: crypto.randomUUID(),
    name: String(name || '').trim(),
    isDefault: false,
    isPrivate: false,
    createdAt: now
  };
  data.collections.push(collection);
  saveData(data);
  return collection;
}

function renameCollection({ collectionId, name }) {
  const trimmedName = String(name || '').trim();
  if (!collectionId || !trimmedName) return null;
  const data = getData();
  const collection = data.collections.find(item => item.id === collectionId);
  if (!collection) return null;
  collection.name = trimmedName;
  saveData(data);
  return collection;
}

function deleteNotes(noteIds = []) {
  const ids = new Set(noteIds);
  if (ids.size === 0) return false;
  const data = getData();
  const removedNotes = data.notes.filter(note => ids.has(note.id));
  data.notes = data.notes.filter(note => !ids.has(note.id));
  removedNotes.forEach(note => {
    (note.attachments || []).forEach(att => {
      if (!att.path) return;
      const assetPath = resolveAssetPath(att.path);
      if (fs.existsSync(assetPath)) {
        try {
          fs.unlinkSync(assetPath);
        } catch (err) {
          // Keep note deletion resilient even if one attachment cannot be removed.
        }
      }
    });
  });
  saveData(data);
  return true;
}

function moveNotes(noteIds = [], collectionId) {
  const ids = new Set(noteIds);
  if (ids.size === 0 || !collectionId) return false;
  const data = getData();
  data.notes.forEach(note => {
    if (ids.has(note.id)) {
      note.collectionId = collectionId;
    }
  });
  saveData(data);
  return true;
}

function getDefaultCollectionId(data) {
  return data.collections.find(collection => collection.isDefault)?.id || data.collections[0]?.id || '';
}

function deleteCollection(collectionId) {
  if (!collectionId) return false;
  const data = getData();
  const collection = data.collections.find(item => item.id === collectionId);
  if (!collection || collection.isDefault) return false;
  const removedNotes = data.notes.filter(note => note.collectionId === collectionId);
  removedNotes.forEach(note => {
    (note.attachments || []).forEach(att => {
      if (!att.path) return;
      const assetPath = resolveAssetPath(att.path);
      if (fs.existsSync(assetPath)) {
        try {
          fs.unlinkSync(assetPath);
        } catch (_error) {
          // Keep collection deletion resilient even if one attachment cannot be removed.
        }
      }
    });
  });
  data.notes = data.notes.filter(note => note.collectionId !== collectionId);
  data.collections = data.collections.filter(item => item.id !== collectionId);
  saveData(data);
  return true;
}

function getConfig() {
  const { configPath, dataDir } = ensureStore();
  const data = getData();
  const config = readJson(configPath, {
    shortcut: 'Ctrl+Shift+N',
    dataPath: dataDir,
    sortMode: 'updatedAt',
    lastCollectionId: '',
    theme: 'light'
  });
  if (!config.dataPath) config.dataPath = dataDir;
  if (!config.lastCollectionId) {
    config.lastCollectionId = data.collections[0]?.id || '';
  }
  return config;
}

function saveConfig(config) {
  const { configPath } = ensureStore();
  writeJson(configPath, config);
  return config;
}

function stripHtml(input) {
  return input.replace(/<[^>]*>/g, '');
}

function normalizeTags(tags = []) {
  return tags
    .flatMap(tag => String(tag || '').split(/[，,]/))
    .map(tag => tag.trim())
    .filter(Boolean);
}

function attachmentsEqual(left = [], right = []) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function createNote({ collectionId, title, content, attachments = [], tags = [], order }) {
  const data = getData();
  const now = new Date().toISOString();
  const note = {
    id: crypto.randomUUID(),
    collectionId,
    title,
    content,
    attachments,
    tags: normalizeTags(tags),
    createdAt: now,
    updatedAt: now,
    order: typeof order === 'number' ? order : -Date.now()
  };
  data.notes.push(note);
  saveData(data);
  return note;
}

function appendToNote({ noteId, content, attachments = [] }) {
  const data = getData();
  const note = data.notes.find(n => n.id === noteId);
  if (!note) return null;
  const appendText = String(content || '').trim();
  const nextAttachments = [...(note.attachments || []), ...attachments];
  if (!appendText && attachments.length === 0) {
    return note;
  }
  const previousContent = String(note.content || '').trim();
  const incomingContent = String(content || '').trim();
  const separator = previousContent && incomingContent ? '<br>' : '';
  const nextContent = `${previousContent}${separator}${incomingContent}`;
  note.content = nextContent;
  note.attachments = nextAttachments;
  note.updatedAt = new Date().toISOString();
  note.order = -Date.now();
  saveData(data);
  return note;
}

function updateNote({ noteId, patch }) {
  const data = getData();
  const note = data.notes.find(n => n.id === noteId);
  if (!note) return null;
  const nextPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'tags')) {
    nextPatch.tags = normalizeTags(nextPatch.tags);
  }

  const hasChanges = Object.entries(nextPatch).some(([key, value]) => {
    if (key === 'attachments') {
      return !attachmentsEqual(note.attachments || [], value || []);
    }
    if (key === 'tags') {
      return JSON.stringify(note.tags || []) !== JSON.stringify(value || []);
    }
    return note[key] !== value;
  });

  Object.assign(note, nextPatch);
  if (!hasChanges) {
    saveData(data);
    return note;
  }
  note.updatedAt = new Date().toISOString();
  note.order = -Date.now();
  saveData(data);
  return note;
}

function updateOrders(orderList) {
  const data = getData();
  orderList.forEach(item => {
    const note = data.notes.find(n => n.id === item.id);
    if (note) {
      note.order = item.order;
    }
  });
  saveData(data);
  return true;
}

function saveImageBuffer(buffer, extension = 'png') {
  const { assetsDir } = ensureStore();
  const fileName = `img_${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(assetsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return `assets/${fileName}`;
}

function saveAudioBuffer(buffer, extension = 'webm') {
  const { assetsDir } = ensureStore();
  const fileName = `audio_${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(assetsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return `assets/${fileName}`;
}

function createBackup() {
  const { dataDir } = ensureStore();
  const backupRoot = path.join(dataDir, 'backups');
  ensureDir(backupRoot);
  const backupDir = path.join(backupRoot, `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`);
  copyDir(dataDir, backupDir);
  return backupDir;
}

function exportNotes(noteIds = []) {
  const ids = new Set(noteIds);
  const data = getData();
  const targetNotes = ids.size === 0 ? data.notes : data.notes.filter(note => ids.has(note.id));
  const collectionMap = new Map(data.collections.map(collection => [collection.id, collection.name]));
  const lines = ['# QuickNote 导出', ''];

  targetNotes.forEach(note => {
    const title = note.title || '未命名';
    const collectionName = collectionMap.get(note.collectionId) || '未分类';
    const content = stripHtml(note.content || '').trim();
    lines.push(`## ${title}`);
    lines.push(`- 收藏夹：${collectionName}`);
    lines.push(`- 更新时间：${note.updatedAt}`);
    if ((note.tags || []).length) {
      lines.push(`- 标签：${note.tags.join(' / ')}`);
    }
    if ((note.attachments || []).length) {
      const attachmentSummary = note.attachments.map(att => `${att.type}:${att.path}`).join(' , ');
      lines.push(`- 附件：${attachmentSummary}`);
    }
    lines.push('');
    lines.push(content || '（无正文）');
    lines.push('');
  });

  return lines.join('\n');
}

function resolveAssetPath(relativePath) {
  const { dataDir } = ensureStore();
  return path.join(dataDir, relativePath);
}

function searchNotes({ collectionId, search, sortMode }) {
  const data = getData();
  const term = (search || '').trim().toLowerCase();
  let notes = data.notes.slice();
  if (collectionId && collectionId !== 'all') {
    notes = notes.filter(n => n.collectionId === collectionId);
  }
  if (term) {
    notes = notes.filter(n => {
      const title = (n.title || '').toLowerCase();
      const contentText = stripHtml(n.content || '').toLowerCase();
      const tags = (n.tags || []).join(' ').toLowerCase();
      return title.includes(term) || contentText.includes(term) || tags.includes(term);
    });
  }
  if (sortMode === 'title') {
    notes.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (sortMode === 'custom') {
    notes.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
  } else {
    notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }
  return { notes, collections: data.collections };
}

module.exports = {
  getDataDir,
  getDataPaths,
  getData,
  saveData,
  getConfig,
  saveConfig,
  createNote,
  appendToNote,
  updateNote,
  saveImageBuffer,
  saveAudioBuffer,
  resolveAssetPath,
  searchNotes,
  stripHtml,
  updateOrders,
  createCollection,
  renameCollection,
  deleteCollection,
  deleteNotes,
  createBackup,
  moveNotes,
  exportNotes
};
