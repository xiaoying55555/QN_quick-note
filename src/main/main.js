const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');

let mainWindow;
let quicknoteWindow;
let tray;
let imageViewerWindow;
const noteWindows = new Map();

function createWindowOptions(extra = {}) {
  return {
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    },
    ...extra
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow(createWindowOptions({
    width: 1005,
    height: 629,
    minWidth: 900,
    minHeight: 560,
    frame: false,
    backgroundColor: '#F5F5F0',
    show: true
  }));

  mainWindow.loadFile(path.join(__dirname, '../renderer/main.html'));

  mainWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function createQuicknoteWindow() {
  quicknoteWindow = new BrowserWindow(createWindowOptions({
    width: 419,
    height: 391,
    resizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    parent: mainWindow
  }));

  quicknoteWindow.loadFile(path.join(__dirname, '../renderer/quicknote.html'));

  quicknoteWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    quicknoteWindow.hide();
  });
}

function normalizeNotePayload(payload) {
  const noteId = typeof payload === 'string' ? payload : payload?.noteId;
  const mode = typeof payload === 'string' ? 'read' : payload?.mode || 'read';
  const nextPayload = typeof payload === 'string' ? { noteId, mode } : { ...payload, noteId, mode };
  if (nextPayload.draft && !nextPayload.draftKey) {
    nextPayload.draftKey = crypto.randomUUID();
  }
  return nextPayload;
}

function getNoteWindowKey(payload) {
  if (payload.noteId) {
    return `note:${payload.noteId}`;
  }
  return `draft:${payload.draftKey}`;
}

function sendNotePayload(windowRef, payload) {
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.__notePayload = payload;
  windowRef.__noteId = payload.noteId || null;
  if (windowRef.webContents.isLoading()) return;
  windowRef.webContents.send('note:open', payload);
}

function createNoteWindow(windowKey, payload) {
  const noteWindow = new BrowserWindow(createWindowOptions({
    width: 333,
    height: 524,
    resizable: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    parent: mainWindow
  }));

  noteWindow.__noteKey = windowKey;
  noteWindow.__notePayload = payload;
  noteWindow.__noteId = payload.noteId || null;
  noteWindow.__isPinned = false;
  noteWindow.loadFile(path.join(__dirname, '../renderer/note.html'));

  noteWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    noteWindow.hide();
  });

  noteWindow.on('closed', () => {
    noteWindows.delete(windowKey);
  });

  noteWindow.webContents.on('did-finish-load', () => {
    sendNotePayload(noteWindow, noteWindow.__notePayload);
  });

  noteWindows.set(windowKey, noteWindow);
  return noteWindow;
}

function focusNoteWindow(windowRef, payload) {
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.center();
  windowRef.show();
  windowRef.focus();
  if (typeof windowRef.moveTop === 'function') {
    windowRef.moveTop();
  }
  sendNotePayload(windowRef, payload);
}

function createImageViewerWindow() {
  imageViewerWindow = new BrowserWindow(createWindowOptions({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    frame: false,
    backgroundColor: '#121212',
    show: false,
    parent: mainWindow
  }));

  imageViewerWindow.loadFile(path.join(__dirname, '../renderer/image-viewer.html'));

  imageViewerWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    imageViewerWindow.hide();
  });
}

function showImageViewer(payload) {
  if (!imageViewerWindow || imageViewerWindow.isDestroyed()) {
    createImageViewerWindow();
  }
  imageViewerWindow.__viewerPayload = payload;
  imageViewerWindow.show();
  imageViewerWindow.focus();
  if (typeof imageViewerWindow.moveTop === 'function') {
    imageViewerWindow.moveTop();
  }
  if (!imageViewerWindow.webContents.isLoading()) {
    imageViewerWindow.webContents.send('image-viewer:open', payload);
  } else {
    imageViewerWindow.webContents.once('did-finish-load', () => {
      if (!imageViewerWindow.isDestroyed()) {
        imageViewerWindow.webContents.send('image-viewer:open', imageViewerWindow.__viewerPayload);
      }
    });
  }
  return true;
}

function createTray() {
  const iconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAS0lEQVR4AWOgFvifgWGHwX8QzYBNG3QmI0bQhZC1xQp4b1E0zGmF7YBqG2QWwGqJg2QGqZg2QGqJg2QGqZg0A9+8V8kB2wIAAAAASUVORK5CYII=';
  const icon = nativeImage.createFromDataURL(iconDataUrl);
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '\u6253\u5f00\u4e3b\u754c\u9762',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: '\u5feb\u901f\u8bb0\u5f55',
      click: () => showQuicknote()
    },
    { type: 'separator' },
    {
      label: '\u9000\u51fa',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('QUICKnote');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function showQuicknote() {
  if (!quicknoteWindow) return;
  const bounds = (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
    ? mainWindow.getBounds()
    : screen.getPrimaryDisplay().workArea;
  const margin = 20;
  const x = Math.round(bounds.x + bounds.width - 419 - margin);
  const y = Math.round(bounds.y + bounds.height - 391 - margin);
  quicknoteWindow.setPosition(Math.max(bounds.x, x), Math.max(bounds.y, y));
  quicknoteWindow.show();
  quicknoteWindow.focus();
  quicknoteWindow.webContents.send('quicknote:show');
}

function registerShortcut() {
  const config = store.getConfig();
  globalShortcut.unregisterAll();
  globalShortcut.register(config.shortcut || 'Ctrl+Shift+N', () => {
    showQuicknote();
  });
}

function getAllBroadcastWindows() {
  return [mainWindow, quicknoteWindow, imageViewerWindow, ...noteWindows.values()].filter(Boolean);
}

function broadcast(channel, payload) {
  getAllBroadcastWindows().forEach(win => {
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, payload);
    }
  });
}

app.whenReady().then(() => {
  store.getDataPaths();
  createMainWindow();
  createQuicknoteWindow();
  createTray();
  registerShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createQuicknoteWindow();
    }
  });
});

app.on('window-all-closed', event => {
  event.preventDefault();
});

app.on('before-quit', () => {
  app.isQuiting = true;
});

ipcMain.handle('app:get-path', (_event, name) => app.getPath(name));
ipcMain.handle('app:get-note-window-payload', event => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  return senderWindow?.__notePayload || null;
});

ipcMain.handle('app:show-note', (_event, payload) => {
  const nextPayload = normalizeNotePayload(payload);
  const windowKey = getNoteWindowKey(nextPayload);
  const existingWindow = noteWindows.get(windowKey);
  if (existingWindow && !existingWindow.isDestroyed()) {
    focusNoteWindow(existingWindow, nextPayload);
    return true;
  }

  const noteWindow = createNoteWindow(windowKey, nextPayload);
  focusNoteWindow(noteWindow, nextPayload);
  return true;
});

ipcMain.handle('app:update-note-window-context', (event, payload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return false;
  const nextNoteId = payload?.noteId;
  if (!nextNoteId) return false;
  const nextKey = `note:${nextNoteId}`;
  const previousKey = senderWindow.__noteKey;
  if (previousKey && previousKey !== nextKey) {
    noteWindows.delete(previousKey);
  }
  senderWindow.__noteKey = nextKey;
  senderWindow.__noteId = nextNoteId;
  senderWindow.__notePayload = { noteId: nextNoteId, mode: payload?.mode || 'edit' };
  noteWindows.set(nextKey, senderWindow);
  return true;
});

ipcMain.handle('app:show-quicknote', () => showQuicknote());
ipcMain.handle('app:hide-quicknote', () => {
  if (quicknoteWindow) quicknoteWindow.hide();
});
ipcMain.handle('app:hide-note', event => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return false;
  const isUnsavedDraft = !!senderWindow.__notePayload?.draft && !senderWindow.__noteId;
  if (isUnsavedDraft) {
    noteWindows.delete(senderWindow.__noteKey);
    senderWindow.destroy();
    return true;
  }
  senderWindow.hide();
  return true;
});
ipcMain.handle('app:minimize-main', event => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.minimize();
    return true;
  }
  return false;
});
ipcMain.handle('app:open-data-path', async () => {
  const result = await shell.openPath(store.getDataDir());
  return result === '';
});
ipcMain.handle('app:set-note-pin', (event, isPinned) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.__isPinned = !!isPinned;
    senderWindow.setAlwaysOnTop(!!isPinned);
    return true;
  }
  return false;
});
ipcMain.handle('app:show-image-viewer', (_event, payload) => showImageViewer(payload));
ipcMain.handle('app:hide-image-viewer', () => {
  if (imageViewerWindow) imageViewerWindow.hide();
});

ipcMain.handle('data:get', () => store.getData());
ipcMain.handle('data:search', (_event, payload) => store.searchNotes(payload));
ipcMain.handle('data:get-config', () => store.getConfig());
ipcMain.handle('data:save-config', (_event, config) => {
  const saved = store.saveConfig(config);
  registerShortcut();
  return saved;
});
ipcMain.handle('data:create-note', (_event, payload) => {
  const note = store.createNote(payload);
  broadcast('data:updated');
  return note;
});
ipcMain.handle('data:create-collection', (_event, payload) => {
  const collection = store.createCollection(payload);
  broadcast('data:updated');
  return collection;
});
ipcMain.handle('data:rename-collection', (_event, payload) => {
  const collection = store.renameCollection(payload);
  broadcast('data:updated');
  return collection;
});
ipcMain.handle('data:delete-collection', (_event, collectionId) => {
  const result = store.deleteCollection(collectionId);
  broadcast('data:updated');
  return result;
});
ipcMain.handle('data:delete-notes', (_event, noteIds) => {
  const result = store.deleteNotes(noteIds);
  broadcast('data:updated');
  return result;
});
ipcMain.handle('data:move-notes', (_event, payload) => {
  const result = store.moveNotes(payload.noteIds, payload.collectionId);
  broadcast('data:updated');
  return result;
});
ipcMain.handle('data:append-note', (_event, payload) => {
  const note = store.appendToNote(payload);
  broadcast('data:updated');
  return note;
});
ipcMain.handle('data:update-note', (_event, payload) => {
  const note = store.updateNote(payload);
  broadcast('data:updated');
  return note;
});
ipcMain.handle('data:update-orders', (_event, payload) => {
  const result = store.updateOrders(payload);
  broadcast('data:updated');
  return result;
});
ipcMain.handle('data:create-backup', () => store.createBackup());
ipcMain.handle('data:export-notes', async (_event, noteIds) => {
  const result = await dialog.showSaveDialog({
    defaultPath: path.join(store.getDataDir(), `QuickNote_${Date.now()}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, store.exportNotes(noteIds), 'utf-8');
  return result.filePath;
});
ipcMain.handle('data:save-image', (_event, buffer) => store.saveImageBuffer(Buffer.from(buffer), 'png'));
ipcMain.handle('data:save-audio', (_event, payload) => {
  const { buffer, extension } = payload;
  return store.saveAudioBuffer(Buffer.from(buffer), extension || 'webm');
});
ipcMain.handle('dialog:open-image', async () => {
  return dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
  });
});
