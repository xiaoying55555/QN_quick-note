const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function getDataDir() {
  return path.join(app.getPath('documents'), 'QuickNote');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyDir(sourceDir, targetDir, options = {}) {
  const shouldSkip = typeof options.shouldSkip === 'function' ? options.shouldSkip : () => false;
  ensureDir(targetDir);
  if (!fs.existsSync(sourceDir)) return;
  fs.readdirSync(sourceDir, { withFileTypes: true }).forEach(entry => {
    const sourcePath = path.join(sourceDir, entry.name);
    if (shouldSkip(sourcePath, entry)) return;
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath, options);
      return;
    }
    fs.copyFileSync(sourcePath, targetPath);
  });
}

function escapePowerShell(value) {
  return String(value || '').replace(/'/g, "''");
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

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || ''), 'utf8').digest('hex');
}

function removeDirContents(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  fs.readdirSync(dirPath, { withFileTypes: true }).forEach(entry => {
    const targetPath = path.join(dirPath, entry.name);
    fs.rmSync(targetPath, { recursive: true, force: true });
  });
}

function getBackupRoot() {
  return path.join(getDataDir(), 'backups');
}

function createTempWorkspace(prefix) {
  const workspace = path.join(app.getPath('temp'), `${prefix}-${crypto.randomUUID()}`);
  ensureDir(workspace);
  return workspace;
}

function compressDirectoryToZip(sourceDir, zipPath) {
  const command = [
    `$source = '${escapePowerShell(sourceDir)}'`,
    `$zipPath = '${escapePowerShell(zipPath)}'`,
    "$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $zipPath)",
    "$archiveSource = Join-Path $source '*'",
    "Compress-Archive -Path $archiveSource -DestinationPath $zipPath -Force"
  ].join('; ');
  execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true
  });
}

function extractZipToDirectory(zipPath, targetDir) {
  const command = [
    `$zipPath = '${escapePowerShell(zipPath)}'`,
    `$targetDir = '${escapePowerShell(targetDir)}'`,
    "$null = New-Item -ItemType Directory -Force -Path $targetDir",
    "Expand-Archive -LiteralPath $zipPath -DestinationPath $targetDir -Force"
  ].join('; ');
  execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true
  });
}

function pruneBackups(limit = 30) {
  const backupRoot = getBackupRoot();
  ensureDir(backupRoot);
  const backupEntries = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter(entry => entry.name.startsWith('backup_'))
    .map(entry => {
      const fullPath = path.join(backupRoot, entry.name);
      const stats = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stats.mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  backupEntries.slice(limit).forEach(entry => {
    fs.rmSync(entry.fullPath, { recursive: true, force: true });
  });
}

function getFrontCollectionOrder(notes, collectionId, isPinned) {
  const groupOrders = getCollectionGroupOrders(notes, collectionId, isPinned);
  if (!groupOrders.length) return 0;
  return Math.min(...groupOrders) - 1;
}

function getFrontPinnedStatusOrder(notes, isPinned) {
  const groupOrders = notes
    .filter(note => !!note.isPinnedInCollection === !!isPinned)
    .map(note => Number(note.order))
    .filter(order => Number.isFinite(order));
  if (!groupOrders.length) return 0;
  return Math.min(...groupOrders) - 1;
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
          createdAt: now,
          order: 0
        }
      ],
      notes: []
    };
    writeJson(dataPath, data);

    const config = {
      shortcut: 'Ctrl+Q',
      dataPath: dataDir,
      sortMode: 'updatedAt',
      lastCollectionId: defaultCollectionId,
      theme: 'light',
      readClipboardOnQuicknote: false,
      rememberState: true,
      autoBackupIntervalDays: 30,
      lastAutoBackupAt: '',
      privateCollectionEnabled: false,
      privateCollectionId: '',
      privateCollectionPasswordHash: ''
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
          createdAt: now,
          order: 0
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
        shortcut: 'Ctrl+Q',
        dataPath: dataDir,
        sortMode: 'updatedAt',
        lastCollectionId: data.collections[0]?.id || '',
        theme: 'light',
        readClipboardOnQuicknote: false,
        rememberState: true,
        autoBackupIntervalDays: 30,
        lastAutoBackupAt: '',
        privateCollectionEnabled: false,
        privateCollectionId: '',
        privateCollectionPasswordHash: ''
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
  const data = readJson(dataPath, { collections: [], notes: [] });
  let dirty = false;
  data.collections = (data.collections || []).map((collection, index) => {
    if (typeof collection.order === 'number' && Number.isFinite(collection.order)) {
      return collection;
    }
    dirty = true;
    return {
      ...collection,
      order: index
    };
  }).sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
  if (dirty) {
    saveData(data);
  }
  return data;
}

function saveData(data) {
  const { dataPath } = ensureStore();
  writeJson(dataPath, data);
  return data;
}

function createCollection({ name }) {
  const data = getData();
  const now = new Date().toISOString();
  const nextOrder = data.collections.reduce((maxOrder, item) => (
    Number.isFinite(item.order) ? Math.max(maxOrder, item.order) : maxOrder
  ), -1) + 1;
  const collection = {
    id: crypto.randomUUID(),
    name: String(name || '').trim(),
    isDefault: false,
    isPrivate: false,
    createdAt: now,
    order: nextOrder
  };
  data.collections.push(collection);
  saveData(data);
  return collection;
}

function ensurePrivateCollection() {
  const data = getData();
  const config = getConfig();
  const now = new Date().toISOString();
  let collection = null;

  if (config.privateCollectionId) {
    collection = data.collections.find(item => item.id === config.privateCollectionId) || null;
  }
  if (!collection) {
    collection = data.collections.find(item => item.isPrivate) || null;
  }
  if (!collection) {
    const minOrder = data.collections.reduce((currentMin, item) => (
      Number.isFinite(item.order) ? Math.min(currentMin, item.order) : currentMin
    ), 0);
    collection = {
      id: crypto.randomUUID(),
      name: '隐私收藏夹',
      isDefault: false,
      isPrivate: true,
      createdAt: now,
      order: minOrder - 1
    };
    data.collections.unshift(collection);
  } else {
    collection.isPrivate = true;
    if (!collection.name) {
      collection.name = '隐私收藏夹';
    }
    if (!Number.isFinite(collection.order)) {
      collection.order = 0;
    }
  }

  saveData(data);
  saveConfig({
    ...config,
    privateCollectionEnabled: true,
    privateCollectionId: collection.id
  });
  return collection;
}

function getPrivateCollectionState() {
  const data = getData();
  const config = getConfig();
  const privateCollection = data.collections.find(item => item.isPrivate || item.id === config.privateCollectionId) || null;
  return {
    enabled: !!config.privateCollectionEnabled,
    collectionId: privateCollection?.id || config.privateCollectionId || '',
    hasPassword: !!config.privateCollectionPasswordHash,
    name: privateCollection?.name || '隐私收藏夹'
  };
}

function setPrivateCollectionEnabled(enabled) {
  const config = getConfig();
  saveConfig({
    ...config,
    privateCollectionEnabled: !!enabled
  });
  return getPrivateCollectionState();
}

function setPrivateCollectionPassword(password) {
  const collection = ensurePrivateCollection();
  const config = getConfig();
  const trimmed = String(password || '').trim();
  if (!trimmed) return false;
  saveConfig({
    ...config,
    privateCollectionEnabled: true,
    privateCollectionId: collection.id,
    privateCollectionPasswordHash: hashPassword(trimmed)
  });
  return true;
}

function verifyPrivateCollectionPassword(password) {
  const config = getConfig();
  const trimmed = String(password || '').trim();
  if (!trimmed || !config.privateCollectionPasswordHash) return false;
  return hashPassword(trimmed) === config.privateCollectionPasswordHash;
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
    shortcut: 'Ctrl+Q',
    dataPath: dataDir,
    sortMode: 'updatedAt',
    lastCollectionId: '',
    theme: 'light',
    readClipboardOnQuicknote: false,
    rememberState: true,
    autoBackupIntervalDays: 30,
    lastAutoBackupAt: '',
    privateCollectionEnabled: false,
    privateCollectionId: '',
    privateCollectionPasswordHash: ''
  });
  if (!config.dataPath) config.dataPath = dataDir;
  if (!config.lastCollectionId) {
    config.lastCollectionId = data.collections[0]?.id || '';
  }
  if (typeof config.readClipboardOnQuicknote !== 'boolean') {
    config.readClipboardOnQuicknote = false;
  }
  if (typeof config.rememberState !== 'boolean') {
    config.rememberState = true;
  }
  if (!Number.isFinite(Number(config.autoBackupIntervalDays)) || Number(config.autoBackupIntervalDays) < 0) {
    config.autoBackupIntervalDays = 30;
  } else {
    config.autoBackupIntervalDays = Math.floor(Number(config.autoBackupIntervalDays));
  }
  if (typeof config.lastAutoBackupAt !== 'string') {
    config.lastAutoBackupAt = '';
  }
  if (typeof config.privateCollectionEnabled !== 'boolean') {
    config.privateCollectionEnabled = false;
  }
  if (typeof config.privateCollectionId !== 'string') {
    config.privateCollectionId = '';
  }
  if (typeof config.privateCollectionPasswordHash !== 'string') {
    config.privateCollectionPasswordHash = '';
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
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getCollectionGroupOrders(notes, collectionId, isPinned) {
  return notes
    .filter(note => note.collectionId === collectionId && !!note.isPinnedInCollection === !!isPinned)
    .map(note => Number(note.order))
    .filter(order => Number.isFinite(order));
}

function getNextCollectionOrder(notes, collectionId, isPinned) {
  const groupOrders = getCollectionGroupOrders(notes, collectionId, isPinned);
  if (!groupOrders.length) return 0;
  if (isPinned) {
    return Math.min(...groupOrders) - 1;
  }
  return Math.max(...groupOrders) + 1;
}

function shouldPromoteNormalNoteInCustomSort(isPinned) {
  if (isPinned) return false;
  return getConfig().sortMode === 'custom';
}

function getPreferredCollectionOrder(notes, collectionId, isPinned) {
  if (shouldPromoteNormalNoteInCustomSort(isPinned)) {
    return getFrontPinnedStatusOrder(notes, isPinned);
  }
  return getNextCollectionOrder(notes, collectionId, isPinned);
}

function createNote({ collectionId, title, content, attachments = [], tags = [], plannedDate = '', order }) {
  const data = getData();
  const now = new Date().toISOString();
  const isPinnedInCollection = false;
  const note = {
    id: crypto.randomUUID(),
    collectionId,
    title,
    content,
    attachments,
    tags: normalizeTags(tags),
    plannedDate: normalizePlannedDate(plannedDate),
    createdAt: now,
    updatedAt: now,
    order: typeof order === 'number' ? order : getPreferredCollectionOrder(data.notes, collectionId, isPinnedInCollection),
    isPinnedInCollection
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
  if (shouldPromoteNormalNoteInCustomSort(!!note.isPinnedInCollection)) {
    note.order = getFrontPinnedStatusOrder(data.notes.filter(item => item.id !== noteId), !!note.isPinnedInCollection);
  }
  note.updatedAt = new Date().toISOString();
  saveData(data);
  return note;
}

function updateNote({ noteId, patch }) {
  const data = getData();
  const note = data.notes.find(n => n.id === noteId);
  if (!note) return null;
  const previousCollectionId = note.collectionId;
  const previousPinned = !!note.isPinnedInCollection;
  const nextPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'tags')) {
    nextPatch.tags = normalizeTags(nextPatch.tags);
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'isPinnedInCollection')) {
    nextPatch.isPinnedInCollection = !!nextPatch.isPinnedInCollection;
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'plannedDate')) {
    nextPatch.plannedDate = normalizePlannedDate(nextPatch.plannedDate);
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
  const nextCollectionId = note.collectionId;
  const nextPinned = !!note.isPinnedInCollection;
  if (nextCollectionId !== previousCollectionId || nextPinned !== previousPinned) {
    note.order = getPreferredCollectionOrder(
      data.notes.filter(item => item.id !== noteId),
      nextCollectionId,
      nextPinned
    );
  } else if (shouldPromoteNormalNoteInCustomSort(nextPinned)) {
    note.order = getFrontPinnedStatusOrder(
      data.notes.filter(item => item.id !== noteId),
      nextPinned
    );
  }
  note.updatedAt = new Date().toISOString();
  saveData(data);
  return note;
}

function updateImageAttachmentRemark(pathValue, remark) {
  const targetPath = String(pathValue || '').trim();
  if (!targetPath) return false;
  const nextRemark = String(remark || '');
  const data = getData();
  let hasChanges = false;
  data.notes.forEach(note => {
    const attachments = Array.isArray(note.attachments) ? note.attachments : [];
    attachments.forEach(attachment => {
      if (attachment?.type !== 'image' || attachment.path !== targetPath) return;
      if (String(attachment.remark || '') === nextRemark) return;
      attachment.remark = nextRemark;
      note.updatedAt = new Date().toISOString();
      hasChanges = true;
    });
  });
  if (!hasChanges) return false;
  saveData(data);
  return true;
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

function updateCollectionOrders(orderList) {
  const data = getData();
  orderList.forEach(item => {
    const collection = data.collections.find(entry => entry.id === item.id);
    if (collection) {
      collection.order = item.order;
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

function saveImageAssetSet({ imageBuffer, thumbnailBuffer, extension = 'png', thumbnailExtension = extension }) {
  const { assetsDir } = ensureStore();
  const imageFileName = `img_${crypto.randomUUID()}.${extension}`;
  const imageFilePath = path.join(assetsDir, imageFileName);
  fs.writeFileSync(imageFilePath, imageBuffer);

  let thumbnailPath = null;
  if (thumbnailBuffer) {
    const thumbFileName = `thumb_${crypto.randomUUID()}.${thumbnailExtension}`;
    const thumbFilePath = path.join(assetsDir, thumbFileName);
    fs.writeFileSync(thumbFilePath, thumbnailBuffer);
    thumbnailPath = `assets/${thumbFileName}`;
  }

  return {
    path: `assets/${imageFileName}`,
    thumbnailPath
  };
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
  const backupRoot = getBackupRoot();
  ensureDir(backupRoot);
  const stagingDir = createTempWorkspace('quicknote-backup');
  const backupZipPath = path.join(backupRoot, `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
  try {
    copyDir(dataDir, stagingDir, {
      shouldSkip(sourcePath) {
        return sourcePath === backupRoot || sourcePath.startsWith(`${backupRoot}${path.sep}`);
      }
    });
    compressDirectoryToZip(stagingDir, backupZipPath);
    pruneBackups(30);
    return backupZipPath;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function runScheduledBackupIfNeeded() {
  const config = getConfig();
  const intervalDays = Number(config.autoBackupIntervalDays) || 0;
  if (intervalDays <= 0) return null;
  const lastBackupAt = Date.parse(config.lastAutoBackupAt || '');
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
  if (Number.isFinite(lastBackupAt) && (Date.now() - lastBackupAt) < intervalMs) {
    return null;
  }
  const backupPath = createBackup();
  if (!backupPath) return null;
  config.lastAutoBackupAt = new Date().toISOString();
  saveConfig(config);
  return backupPath;
}

function importBackup(backupDir) {
  const sourceInputPath = String(backupDir || '').trim();
  if (!sourceInputPath) return null;
  const isZipBackup = fs.existsSync(sourceInputPath)
    && fs.statSync(sourceInputPath).isFile()
    && sourceInputPath.toLowerCase().endsWith('.zip');
  const extractionDir = isZipBackup ? createTempWorkspace('quicknote-import') : null;
  const sourceDir = isZipBackup ? extractionDir : sourceInputPath;

  try {
    if (isZipBackup) {
      extractZipToDirectory(sourceInputPath, extractionDir);
    }

    const sourceDataPath = path.join(sourceDir, 'data.json');
    const sourceConfigPath = path.join(sourceDir, 'config.json');
    const sourceAssetsDir = path.join(sourceDir, 'assets');
    if (!fs.existsSync(sourceDataPath) || !fs.existsSync(sourceConfigPath)) {
      return null;
    }

    const importedData = readJson(sourceDataPath, null);
    const importedConfig = readJson(sourceConfigPath, null);
    if (!importedData || !Array.isArray(importedData.collections) || !Array.isArray(importedData.notes) || !importedConfig) {
      return null;
    }

    const { dataDir, dataPath, configPath, assetsDir } = ensureStore();
    writeJson(dataPath, importedData);
    writeJson(configPath, {
      ...importedConfig,
      dataPath: dataDir
    });

    ensureDir(assetsDir);
    removeDirContents(assetsDir);
    if (fs.existsSync(sourceAssetsDir)) {
      copyDir(sourceAssetsDir, assetsDir);
    }

    return dataDir;
  } finally {
    if (extractionDir) {
      fs.rmSync(extractionDir, { recursive: true, force: true });
    }
  }
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
    if (note.plannedDate) {
      lines.push(`- 计划日期：${note.plannedDate}`);
    }
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

function searchNotes({ collectionId, search, sortMode, allowPrivateCollectionAccess = false }) {
  const data = getData();
  const config = getConfig();
  const term = (search || '').trim().toLowerCase();
  const privateCollectionId = config.privateCollectionId
    || data.collections.find(collection => collection.isPrivate)?.id
    || '';
  let notes = data.notes.slice();

  if (collectionId === privateCollectionId && !allowPrivateCollectionAccess) {
    notes = [];
  } else if (collectionId && collectionId !== 'all') {
    notes = notes.filter(n => n.collectionId === collectionId);
  } else if (privateCollectionId) {
    notes = notes.filter(n => n.collectionId !== privateCollectionId);
  }

  if (collectionId !== privateCollectionId && privateCollectionId) {
    notes = notes.filter(n => n.collectionId !== privateCollectionId);
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
    notes.sort((a, b) => {
      const aPinned = !!a.isPinnedInCollection;
      const bPinned = !!b.isPinnedInCollection;
      if (aPinned !== bPinned) {
        return Number(bPinned) - Number(aPinned);
      }
      return (a.order ?? 9999) - (b.order ?? 9999);
    });
  } else {
    notes.sort((a, b) => {
      const aPinned = !!a.isPinnedInCollection;
      const bPinned = !!b.isPinnedInCollection;
      if (aPinned !== bPinned) {
        return Number(bPinned) - Number(aPinned);
      }
      if (aPinned && bPinned) {
        return (a.order ?? 9999) - (b.order ?? 9999);
      }
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
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
  updateImageAttachmentRemark,
  saveImageBuffer,
  saveImageAssetSet,
  saveAudioBuffer,
  resolveAssetPath,
  searchNotes,
  stripHtml,
  updateOrders,
  updateCollectionOrders,
  createCollection,
  renameCollection,
  ensurePrivateCollection,
  getPrivateCollectionState,
  setPrivateCollectionEnabled,
  setPrivateCollectionPassword,
  verifyPrivateCollectionPassword,
  deleteCollection,
  deleteNotes,
  createBackup,
  runScheduledBackupIfNeeded,
  importBackup,
  moveNotes,
  exportNotes
};
