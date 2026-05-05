const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage, dialog, shell, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let mainWindow;
let quicknoteWindow;
let tray;
let imageViewerWindow;
let ocrSelectionWindow;
const noteWindows = new Map();

const QUICKNOTE_WIDTH = 419;
const QUICKNOTE_HEIGHT = 391;
const OCR_SHORTCUT = 'Alt+Shift+S';
const MAIN_WINDOW_WIDTH = 1045;
const MAIN_WINDOW_HEIGHT = 629;

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
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_WIDTH,
    minHeight: MAIN_WINDOW_HEIGHT,
    frame: false,
    backgroundColor: '#F5F5F0',
    show: true
  }));

  mainWindow.loadFile(path.join(__dirname, '../renderer/main.html'));

  mainWindow.on('focus', () => {
    bringNoteWindowsAboveMain();
  });

  mainWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function bringNoteWindowsAboveMain() {
  noteWindows.forEach(windowRef => {
    if (!windowRef || windowRef.isDestroyed() || !windowRef.isVisible()) return;
    if (typeof windowRef.moveTop === 'function') {
      windowRef.moveTop();
    }
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
  }));

  quicknoteWindow.loadFile(path.join(__dirname, '../renderer/quicknote.html'));

  quicknoteWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    quicknoteWindow.destroy();
  });

  quicknoteWindow.on('closed', () => {
    quicknoteWindow = null;
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
    minWidth: 333,
    maxWidth: 333,
    minHeight: 524,
    resizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
  }));

  noteWindow.__noteKey = windowKey;
  noteWindow.__notePayload = payload;
  noteWindow.__noteId = payload.noteId || null;
  noteWindow.__isPinned = false;
  noteWindow.loadFile(path.join(__dirname, '../renderer/note.html'));

  noteWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    noteWindow.destroy();
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
  sendNotePayload(windowRef, payload);
  if (!windowRef.isVisible()) {
    windowRef.center();
    windowRef.show();
  }
  windowRef.focus();
  if (typeof windowRef.moveTop === 'function') {
    windowRef.moveTop();
  }
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

function getQuicknoteAnchorBounds() {
  const point = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point).workArea;
}

function positionQuicknoteWindow() {
  if (!quicknoteWindow || quicknoteWindow.isDestroyed()) return;
  const bounds = getQuicknoteAnchorBounds();
  const margin = 20;
  const x = Math.round(bounds.x + bounds.width - QUICKNOTE_WIDTH - margin);
  const y = Math.round(bounds.y + bounds.height - QUICKNOTE_HEIGHT - margin);
  quicknoteWindow.setBounds({
    x: Math.max(bounds.x, x),
    y: Math.max(bounds.y, y),
    width: QUICKNOTE_WIDTH,
    height: QUICKNOTE_HEIGHT
  });
}

function showQuicknote(payload = {}) {
  if (!quicknoteWindow || quicknoteWindow.isDestroyed()) {
    createQuicknoteWindow();
  }
  positionQuicknoteWindow();
  const showPayload = {
    prefillText: '',
    source: 'manual',
    forceExpanded: false,
    ...payload
  };
  const dispatch = () => {
    if (!quicknoteWindow || quicknoteWindow.isDestroyed()) return;
    positionQuicknoteWindow();
    quicknoteWindow.webContents.send('quicknote:show', showPayload);
    quicknoteWindow.show();
    quicknoteWindow.focus();
  };
  if (quicknoteWindow.webContents.isLoading()) {
    quicknoteWindow.webContents.once('did-finish-load', dispatch);
  } else {
    dispatch();
  }
  return true;
}

function registerShortcut() {
  const config = store.getConfig();
  globalShortcut.unregisterAll();
  globalShortcut.register(config.shortcut || 'Ctrl+Shift+N', () => {
    showQuicknote();
  });
  globalShortcut.register(OCR_SHORTCUT, () => {
    startOcrSelection();
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

function createOcrSelectionWindow(display) {
  ocrSelectionWindow = new BrowserWindow(createWindowOptions({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false
  }));
  ocrSelectionWindow.__displayId = display.id;
  ocrSelectionWindow.loadFile(path.join(__dirname, '../renderer/ocr-selection.html'));
  ocrSelectionWindow.once('ready-to-show', () => {
    if (!ocrSelectionWindow || ocrSelectionWindow.isDestroyed()) return;
    ocrSelectionWindow.show();
    ocrSelectionWindow.focus();
  });
  ocrSelectionWindow.on('closed', () => {
    ocrSelectionWindow = null;
  });
}

function startOcrSelection() {
  if (ocrSelectionWindow && !ocrSelectionWindow.isDestroyed()) {
    ocrSelectionWindow.focus();
    return;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  createOcrSelectionWindow(display);
}

async function captureDisplayRegion(displayId, region) {
  const display = screen.getAllDisplays().find(item => item.id === displayId) || screen.getPrimaryDisplay();
  const scaleFactor = display.scaleFactor || 1;
  const captureWidth = Math.round(display.bounds.width * scaleFactor);
  const captureHeight = Math.round(display.bounds.height * scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: captureWidth, height: captureHeight }
  });
  const source = sources.find(item => item.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Screen capture unavailable');
  }
  return source.thumbnail.crop({
    x: Math.max(0, Math.round(region.x * scaleFactor)),
    y: Math.max(0, Math.round(region.y * scaleFactor)),
    width: Math.max(1, Math.round(region.width * scaleFactor)),
    height: Math.max(1, Math.round(region.height * scaleFactor))
  });
}

async function writeTempCapture(image) {
  const tempPath = path.join(app.getPath('temp'), 'quicknote-ocr-' + Date.now() + '.png');
  await fs.promises.writeFile(tempPath, image.toPNG());
  return tempPath;
}

async function runWindowsOcr(imagePath) {
  const escapedPath = imagePath.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]',
    '$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]',
    '$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]',
    '$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]',
    '$null = [System.WindowsRuntimeSystemExtensions]',
    'function Await($task) { [System.WindowsRuntimeSystemExtensions]::AsTask($task).GetAwaiter().GetResult() }',
    "$file = Await([Windows.Storage.StorageFile]::GetFileFromPathAsync('" + escapedPath + "'))",
    '$stream = Await($file.OpenAsync([Windows.Storage.FileAccessMode]::Read))',
    '$decoder = Await([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))',
    '$bitmap = Await($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied))',
    '$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
    "if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language('zh-CN'))) }",
    "if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language('en-US'))) }",
    "if ($null -eq $engine) { throw 'OCR engine unavailable' }",
    '$result = Await($engine.RecognizeAsync($bitmap))',
    '($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine'
  ].join('; ');
  const { stdout } = await execFileAsync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });
  return String(stdout || '').trim();
}

async function handleOcrSelection(displayId, region) {
  const image = await captureDisplayRegion(displayId, region);
  const tempPath = await writeTempCapture(image);
  try {
    const text = await runWindowsOcr(tempPath);
    if (!text.trim()) {
      throw new Error('OCR no text detected');
    }
    showQuicknote({
      prefillText: text,
      source: 'ocr',
      forceExpanded: text.length > 20
    });
    return text;
  } finally {
    try {
      await fs.promises.unlink(tempPath);
    } catch (_error) {
      // ignore cleanup failure
    }
  }
}

app.whenReady().then(() => {
  store.getDataPaths();
  createMainWindow();
  createTray();
  registerShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
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

ipcMain.handle('app:submit-ocr-selection', async (event, region) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const displayId = senderWindow?.__displayId || screen.getPrimaryDisplay().id;
  if (senderWindow && !senderWindow.isDestroyed()) {
    senderWindow.destroy();
  }
  setTimeout(() => {
    handleOcrSelection(displayId, region).catch(() => {
      showQuicknote({ prefillText: 'OCR no text detected', source: 'ocr', forceExpanded: false });
    });
  }, 100);
  return true;
});

ipcMain.handle('app:cancel-ocr-selection', event => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed()) {
    senderWindow.destroy();
  }
  return true;
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
  if (quicknoteWindow && !quicknoteWindow.isDestroyed()) quicknoteWindow.close();
});
ipcMain.handle('app:hide-note', event => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return false;
  noteWindows.delete(senderWindow.__noteKey);
  senderWindow.close();
  return true;
});
ipcMain.handle('app:resize-note-window', (event, payload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const nextHeight = Number(payload?.height);
  if (!senderWindow || !Number.isFinite(nextHeight)) return false;
  const bounds = senderWindow.getBounds();
  senderWindow.setBounds({
    ...bounds,
    height: Math.max(524, Math.round(nextHeight))
  });
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
