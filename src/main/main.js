const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage, dialog, shell, screen, desktopCapturer, clipboard, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const { execFile } = require('child_process');
const { promisify } = require('util');

app.disableHardwareAcceleration();

const execFileAsync = promisify(execFile);

let mainWindow;
let quicknoteWindow;
let tray;
let imageViewerWindow;
let ocrSelectionWindow;
const noteWindows = new Map();
let activeFlashcardWindowKey = '';
let noteFloatingResetTimer = null;
let mainWindowLayoutRefreshTimer = null;
let mainWindowStartupFallbackTimer = null;

const QUICKNOTE_WIDTH = 419;
const QUICKNOTE_HEIGHT = 391;
const OCR_SHORTCUT = 'Alt+Shift+S';
const MAIN_WINDOW_WIDTH = 1061;
const MAIN_WINDOW_HEIGHT = 629;
const NOTE_EXPORT_MAX_WIDTH = 760;
const NOTE_EXPORT_MIN_WIDTH = 420;
const MAIN_WINDOW_MARGIN = 24;
const IMAGE_VIEWER_DEFAULT_WIDTH = 860;
const IMAGE_VIEWER_DEFAULT_HEIGHT = 700;
const APP_ICON_PATH = path.join(__dirname, '../renderer/assets/app-logo.png');

function getRuntimeAppIcon() {
  return fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined;
}

function logMainProcessEvent(message) {
  try {
    const logPath = path.join(app.getPath('userData'), 'startup.log');
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (_error) {
    // Ignore logging failures to avoid breaking startup.
  }
}

function createWindowOptions(extra = {}) {
  return {
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    },
    icon: getRuntimeAppIcon(),
    ...extra
  };
}

function getMainWindowTargetDisplay(windowRef) {
  if (windowRef && !windowRef.isDestroyed()) {
    return screen.getDisplayMatching(windowRef.getBounds());
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function getMainWindowLayoutMetrics(display) {
  const workArea = display?.workArea || screen.getPrimaryDisplay().workArea;
  const availableWidth = Math.max(320, workArea.width - MAIN_WINDOW_MARGIN);
  const availableHeight = Math.max(360, workArea.height - MAIN_WINDOW_MARGIN);
  const scale = Math.min(
    1,
    availableWidth / MAIN_WINDOW_WIDTH,
    availableHeight / MAIN_WINDOW_HEIGHT
  );

  return {
    scale,
    width: Math.max(1, Math.floor(MAIN_WINDOW_WIDTH * scale)),
    height: Math.max(1, Math.floor(MAIN_WINDOW_HEIGHT * scale))
  };
}

function applyMainWindowNormalLayout(windowRef) {
  if (!windowRef || windowRef.isDestroyed()) return;
  const display = getMainWindowTargetDisplay(windowRef);
  const metrics = getMainWindowLayoutMetrics(display);
  windowRef.webContents.setZoomFactor(metrics.scale);
  windowRef.setContentSize(metrics.width, metrics.height);
  windowRef.center();
}

function refreshMainWindowLayout(windowRef = mainWindow) {
  if (!windowRef || windowRef.isDestroyed()) return;
  if (windowRef.isMaximized() || windowRef.isMinimized()) return;
  applyMainWindowNormalLayout(windowRef);
}

function scheduleMainWindowLayoutRefresh(windowRef = mainWindow, delay = 60) {
  if (mainWindowLayoutRefreshTimer) {
    clearTimeout(mainWindowLayoutRefreshTimer);
  }
  mainWindowLayoutRefreshTimer = setTimeout(() => {
    mainWindowLayoutRefreshTimer = null;
    refreshMainWindowLayout(windowRef);
  }, delay);
}

function escapeHtml(input = '') {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function noteContentToExportHtml(content = '') {
  return String(content || '')
    .replace(/\r?\n/g, '<br>')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
}

async function exportNoteAsImage(note, targetPath) {
  const imageAttachments = (note.attachments || [])
    .filter(att => att.type === 'image' && att.path)
    .map(att => {
      const resolvedPath = store.resolveAssetPath(att.path).replace(/\\/g, '/');
      return `file:///${resolvedPath}`;
    });
  const audioAttachments = (note.attachments || []).filter(att => att.type === 'audio');
  const hasImageAttachments = imageAttachments.length > 0;
  const tags = (note.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  const imageMarkup = imageAttachments.map(url => `<img class="attachment-image" src="${url}" alt="" />`).join('');
  const audioMarkup = audioAttachments.map(att => (
    `<div class="audio-item">录音 ${Math.max(1, Number(att.duration) || 0)}s</div>`
  )).join('');
  const html = `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #ffffff; font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; color: #243011; }
        body { display: inline-block; width: fit-content; min-width: 0; }
        .page {
          display: inline-block;
          width: fit-content;
          min-width: ${NOTE_EXPORT_MIN_WIDTH}px;
          max-width: ${NOTE_EXPORT_MAX_WIDTH}px;
          padding: 32px 32px 28px;
          background: #ffffff;
        }
        .page.has-images { width: ${NOTE_EXPORT_MAX_WIDTH}px; }
        .title { font-size: 28px; line-height: 1.35; font-weight: 700; margin: 0; }
        .meta { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 8px; }
        .tag { display: inline-flex; align-items: center; min-height: 28px; padding: 0 12px; border-radius: 999px; background: #f0f5df; color: #59711d; font-size: 14px; }
        .content { margin-top: 20px; font-size: 17px; line-height: 1.75; word-break: break-word; }
        .attachments { margin-top: 22px; display: flex; flex-direction: column; gap: 14px; }
        .attachment-image { width: 100%; display: block; border-radius: 16px; object-fit: contain; background: #f2f2ec; }
        .audio-item { min-height: 42px; border-radius: 14px; background: #f3f6e8; display: flex; align-items: center; padding: 0 14px; color: #5a6d22; font-size: 15px; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="page ${hasImageAttachments ? 'has-images' : ''}">
        <h1 class="title">${escapeHtml(note.title || '未命名')}</h1>
        ${tags ? `<div class="meta">${tags}</div>` : ''}
        <div class="content">${noteContentToExportHtml(note.content || '（无正文）')}</div>
        ${(imageMarkup || audioMarkup) ? `<div class="attachments">${imageMarkup}${audioMarkup}</div>` : ''}
      </div>
    </body>
  </html>`;

  const exportWindow = new BrowserWindow({
    width: NOTE_EXPORT_MAX_WIDTH,
    height: 900,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      offscreen: true,
      sandbox: false
    }
  });

  try {
    await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await exportWindow.webContents.executeJavaScript(`
      new Promise(resolve => {
        const images = Array.from(document.images);
        if (!images.length) {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
          return;
        }
        let settled = 0;
        const done = () => {
          settled += 1;
          if (settled >= images.length) {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }
        };
        images.forEach(img => {
          if (img.complete) {
            done();
          } else {
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          }
        });
      });
    `);
    const pageMetrics = await exportWindow.webContents.executeJavaScript(`
      (() => {
        const page = document.querySelector('.page');
        if (!page) {
          return { width: ${NOTE_EXPORT_MAX_WIDTH}, height: 900 };
        }
        const rect = page.getBoundingClientRect();
        return {
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height)
        };
      })()
    `);
    exportWindow.setContentSize(
      Math.max(NOTE_EXPORT_MIN_WIDTH, Math.min(NOTE_EXPORT_MAX_WIDTH, pageMetrics.width)),
      Math.max(320, pageMetrics.height)
    );
    await new Promise(resolve => setTimeout(resolve, 80));
    const image = await exportWindow.webContents.capturePage();
    fs.writeFileSync(targetPath, image.toPNG());
    return targetPath;
  } finally {
    if (!exportWindow.isDestroyed()) {
      exportWindow.destroy();
    }
  }
}

function createMainWindow() {
  const initialDisplay = getMainWindowTargetDisplay();
  const initialMetrics = getMainWindowLayoutMetrics(initialDisplay);
  mainWindow = new BrowserWindow(createWindowOptions({
    width: initialMetrics.width,
    height: initialMetrics.height,
    minWidth: 320,
    minHeight: 360,
    useContentSize: true,
    resizable: false,
    frame: false,
    backgroundColor: '#F5F5F0',
    center: true,
    show: false
  }));

  if (mainWindowStartupFallbackTimer) {
    clearTimeout(mainWindowStartupFallbackTimer);
    mainWindowStartupFallbackTimer = null;
  }

  logMainProcessEvent(`createMainWindow width=${initialMetrics.width} height=${initialMetrics.height} scale=${initialMetrics.scale.toFixed(3)}`);
  mainWindow.loadFile(path.join(__dirname, '../renderer/main.html'));

  mainWindow.once('ready-to-show', () => {
    logMainProcessEvent('mainWindow ready-to-show');
    applyMainWindowNormalLayout(mainWindow);
    mainWindow.show();
    if (mainWindowStartupFallbackTimer) {
      clearTimeout(mainWindowStartupFallbackTimer);
      mainWindowStartupFallbackTimer = null;
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logMainProcessEvent('mainWindow did-finish-load');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logMainProcessEvent(`mainWindow did-fail-load code=${errorCode} mainFrame=${isMainFrame} url=${validatedURL} error=${errorDescription}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logMainProcessEvent(`mainWindow render-process-gone reason=${details?.reason || 'unknown'} exitCode=${details?.exitCode ?? 'unknown'}`);
  });

  mainWindow.on('unresponsive', () => {
    logMainProcessEvent('mainWindow unresponsive');
  });

  mainWindowStartupFallbackTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    logMainProcessEvent('mainWindow startup fallback show');
    try {
      applyMainWindowNormalLayout(mainWindow);
      mainWindow.show();
      mainWindow.focus();
    } catch (error) {
      logMainProcessEvent(`mainWindow startup fallback error=${error.message}`);
    }
  }, 6000);

  mainWindow.on('focus', () => {
    syncFloatingNoteWindows(true);
  });

  mainWindow.on('blur', () => {
    scheduleFloatingNoteWindowsReset();
  });

  mainWindow.on('minimize', () => {
    syncFloatingNoteWindows(false);
  });

  mainWindow.on('restore', () => {
    syncFloatingNoteWindows(true);
    scheduleMainWindowLayoutRefresh(mainWindow, 80);
  });

  mainWindow.on('show', () => {
    syncFloatingNoteWindows(true);
    scheduleMainWindowLayoutRefresh(mainWindow, 40);
  });

  mainWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    if (mainWindowStartupFallbackTimer) {
      clearTimeout(mainWindowStartupFallbackTimer);
      mainWindowStartupFallbackTimer = null;
    }
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

function setNoteWindowFloating(windowRef, shouldFloat) {
  if (!windowRef || windowRef.isDestroyed() || windowRef.__isPinned) return;
  windowRef.setAlwaysOnTop(shouldFloat, shouldFloat ? 'floating' : 'normal');
}

function shouldKeepNotesFloating() {
  return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
}

function syncFloatingNoteWindows(shouldFloat) {
  if (noteFloatingResetTimer) {
    clearTimeout(noteFloatingResetTimer);
    noteFloatingResetTimer = null;
  }
  const nextFloatingState = shouldFloat && shouldKeepNotesFloating();
  noteWindows.forEach(windowRef => {
    setNoteWindowFloating(windowRef, nextFloatingState);
  });
}

function scheduleFloatingNoteWindowsReset() {
  if (noteFloatingResetTimer) {
    clearTimeout(noteFloatingResetTimer);
  }
  noteFloatingResetTimer = setTimeout(() => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const appWindows = [mainWindow, quicknoteWindow, imageViewerWindow, ocrSelectionWindow, ...noteWindows.values()]
      .filter(windowRef => windowRef && !windowRef.isDestroyed());
    if (focusedWindow && appWindows.includes(focusedWindow)) {
      return;
    }
    syncFloatingNoteWindows(false);
  }, 60);
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
  if (payload?.windowRole === 'flashcard') {
    if (payload.noteId) {
      return `flashcard:note:${payload.noteId}`;
    }
    return `flashcard:draft:${payload.draftKey}`;
  }
  if (payload.noteId) {
    return `note:${payload.noteId}`;
  }
  return `draft:${payload.draftKey}`;
}

function sendNotePayload(windowRef, payload) {
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.__notePayload = payload;
  windowRef.__noteId = payload.noteId || null;
  windowRef.__windowRole = payload?.windowRole || 'default';
  if (windowRef.webContents.isLoading()) return;
  windowRef.webContents.send('note:open', payload);
}

async function prepareNoteWindowForOpen(windowRef) {
  if (!windowRef || windowRef.isDestroyed() || windowRef.webContents.isLoading()) return;
  try {
    await windowRef.webContents.executeJavaScript('window.__prepareNoteOpen && window.__prepareNoteOpen()', true);
  } catch (_error) {
    if (!windowRef.isDestroyed()) {
      windowRef.webContents.send('note:prepare-open');
    }
  }
}

function createNoteWindow(windowKey, payload) {
  const noteWindow = new BrowserWindow(createWindowOptions({
    width: 335,
    height: 524,
    minWidth: 335,
    maxWidth: 335,
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
  noteWindow.__windowRole = payload?.windowRole || 'default';
  noteWindow.__isPinned = false;
  noteWindow.loadFile(path.join(__dirname, '../renderer/note.html'));

  noteWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    noteWindow.destroy();
  });

  noteWindow.on('closed', () => {
    if (activeFlashcardWindowKey === windowKey) {
      activeFlashcardWindowKey = '';
    }
    noteWindows.delete(windowKey);
  });

  noteWindow.on('focus', () => {
    syncFloatingNoteWindows(true);
  });

  noteWindow.on('blur', () => {
    scheduleFloatingNoteWindowsReset();
  });

  noteWindow.webContents.on('did-finish-load', () => {
    sendNotePayload(noteWindow, noteWindow.__notePayload);
  });

  noteWindows.set(windowKey, noteWindow);
  return noteWindow;
}

async function focusNoteWindow(windowRef, payload) {
  if (!windowRef || windowRef.isDestroyed()) return;
  await prepareNoteWindowForOpen(windowRef);
  sendNotePayload(windowRef, payload);
  if (payload?.pinOnOpen) {
    windowRef.__isPinned = true;
    windowRef.setAlwaysOnTop(true, 'floating');
  }
  setNoteWindowFloating(windowRef, true);
  if (!windowRef.isVisible()) {
    windowRef.center();
    windowRef.showInactive();
  }
  windowRef.focus();
  if (typeof windowRef.moveTop === 'function') {
    windowRef.moveTop();
  }
}

function closeFlashcardWindowIfNeeded(excludedKey = '') {
  if (!activeFlashcardWindowKey || activeFlashcardWindowKey === excludedKey) return false;
  const activeWindow = noteWindows.get(activeFlashcardWindowKey);
  activeFlashcardWindowKey = '';
  if (!activeWindow || activeWindow.isDestroyed()) return false;
  noteWindows.delete(activeWindow.__noteKey);
  activeWindow.destroy();
  return true;
}

function focusTopRemainingNote(excludedWindow) {
  const remainingWindow = Array.from(noteWindows.values()).find(windowRef => (
    windowRef
    && windowRef !== excludedWindow
    && !windowRef.isDestroyed()
    && windowRef.isVisible()
  ));
  if (!remainingWindow) return false;
  if (typeof remainingWindow.moveTop === 'function') {
    remainingWindow.moveTop();
  }
  remainingWindow.focus();
  return true;
}

function createImageViewerWindow() {
  imageViewerWindow = new BrowserWindow(createWindowOptions({
    width: IMAGE_VIEWER_DEFAULT_WIDTH,
    height: IMAGE_VIEWER_DEFAULT_HEIGHT,
    minWidth: 520,
    minHeight: 460,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: true,
    show: false,
    hasShadow: false
  }));

  imageViewerWindow.loadFile(path.join(__dirname, '../renderer/image-viewer.html'));

  imageViewerWindow.on('close', event => {
    if (app.isQuiting) return;
    event.preventDefault();
    imageViewerWindow.destroy();
  });

  imageViewerWindow.on('closed', () => {
    imageViewerWindow = null;
  });
}

function getImageViewerTargetDisplay(payload = {}) {
  const sourceWindowId = Number(payload.sourceWindowId);
  if (Number.isFinite(sourceWindowId)) {
    const sourceWindow = BrowserWindow.fromId(sourceWindowId);
    if (sourceWindow && !sourceWindow.isDestroyed()) {
      return screen.getDisplayMatching(sourceWindow.getBounds());
    }
  }
  if (imageViewerWindow && !imageViewerWindow.isDestroyed()) {
    return screen.getDisplayMatching(imageViewerWindow.getBounds());
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function getImageViewerStableSize(display) {
  const workArea = display?.workArea || screen.getPrimaryDisplay().workArea;
  return {
    width: Math.max(520, Math.min(IMAGE_VIEWER_DEFAULT_WIDTH, workArea.width - 80)),
    height: Math.max(460, Math.min(IMAGE_VIEWER_DEFAULT_HEIGHT, workArea.height - 80))
  };
}

function applyImageViewerStableBounds(payload = {}) {
  if (!imageViewerWindow || imageViewerWindow.isDestroyed()) return null;
  const display = getImageViewerTargetDisplay(payload);
  const nextSize = getImageViewerStableSize(display);
  imageViewerWindow.setContentSize(nextSize.width, nextSize.height);
  imageViewerWindow.center();
  return nextSize;
}

function showImageViewer(payload) {
  if (imageViewerWindow && !imageViewerWindow.isDestroyed()) {
    imageViewerWindow.destroy();
  }
  createImageViewerWindow();
  imageViewerWindow.__viewerPayload = payload;
  applyImageViewerStableBounds(payload);
  imageViewerWindow.setAlwaysOnTop(true, 'screen-saver');
  imageViewerWindow.webContents.once('did-finish-load', () => {
    if (!imageViewerWindow || imageViewerWindow.isDestroyed()) return;
    imageViewerWindow.webContents.send('image-viewer:open', imageViewerWindow.__viewerPayload);
    imageViewerWindow.showInactive();
    if (typeof imageViewerWindow.moveTop === 'function') {
      imageViewerWindow.moveTop();
    }
  });
  return true;
}

function fitImageViewerWindow(payload = {}) {
  if (!imageViewerWindow || imageViewerWindow.isDestroyed()) return false;
  const nextSize = getImageViewerStableSize(getImageViewerTargetDisplay(imageViewerWindow.__viewerPayload || payload));
  const [currentWidth, currentHeight] = imageViewerWindow.getContentSize();
  if (currentWidth !== nextSize.width || currentHeight !== nextSize.height) {
    imageViewerWindow.setContentSize(nextSize.width, nextSize.height);
    imageViewerWindow.center();
  }
  if (typeof imageViewerWindow.moveTop === 'function') {
    imageViewerWindow.moveTop();
  }
  return nextSize;
}

function createTray() {
  const iconPath = getRuntimeAppIcon();
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
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

function getQuicknoteClipboardPrefill() {
  const config = store.getConfig();
  if (!config.readClipboardOnQuicknote) return '';
  const text = String(clipboard.readText() || '').trim();
  return text;
}

function showQuicknote(payload = {}) {
  if (!quicknoteWindow || quicknoteWindow.isDestroyed()) {
    createQuicknoteWindow();
  }
  positionQuicknoteWindow();
  const showPayload = {
    prefillText: payload.prefillText ?? '',
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
    const clipboardText = getQuicknoteClipboardPrefill();
    showQuicknote({
      source: 'shortcut',
      prefillText: clipboardText
    });
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

function normalizeImageExtension(extension = '') {
  const normalized = String(extension || '').replace(/^\./, '').toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'jpg';
  if (normalized === 'webp') return 'jpg';
  return 'png';
}

function getResizedImage(image, maxEdge) {
  const { width, height } = image.getSize();
  if (!width || !height) return image;
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) return image;
  const scale = maxEdge / longestEdge;
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'best'
  });
}

function encodeNativeImage(image, extension) {
  if (extension === 'jpg') {
    return image.toJPEG(82);
  }
  return image.toPNG();
}

function processImageAsset(buffer, extension = 'png') {
  const normalizedExtension = normalizeImageExtension(extension);
  const sourceImage = nativeImage.createFromBuffer(Buffer.from(buffer));
  if (sourceImage.isEmpty()) {
    return {
      imageBuffer: Buffer.from(buffer),
      thumbnailBuffer: null,
      extension: normalizedExtension,
      thumbnailExtension: normalizedExtension
    };
  }

  const mainImage = getResizedImage(sourceImage, 1920);
  const thumbImage = getResizedImage(sourceImage, 360);
  return {
    imageBuffer: encodeNativeImage(mainImage, normalizedExtension),
    thumbnailBuffer: encodeNativeImage(thumbImage, normalizedExtension),
    extension: normalizedExtension,
    thumbnailExtension: normalizedExtension
  };
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
  app.setAppUserModelId('com.quicknote.app');
  logMainProcessEvent('app whenReady');
  const singleInstanceLock = app.requestSingleInstanceLock();
  if (!singleInstanceLock) {
    logMainProcessEvent('single instance lock denied');
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    logMainProcessEvent('app second-instance');
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  store.getDataPaths();
  store.runScheduledBackupIfNeeded();
  store.setPrivateCollectionEnabled(false);
  createMainWindow();
  createTray();
  registerShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  screen.on('display-metrics-changed', () => {
    scheduleMainWindowLayoutRefresh(mainWindow, 80);
  });

  screen.on('display-added', () => {
    scheduleMainWindowLayoutRefresh(mainWindow, 80);
  });

  screen.on('display-removed', () => {
    scheduleMainWindowLayoutRefresh(mainWindow, 80);
  });
});

app.on('window-all-closed', event => {
  event.preventDefault();
});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (mainWindowLayoutRefreshTimer) {
    clearTimeout(mainWindowLayoutRefreshTimer);
    mainWindowLayoutRefreshTimer = null;
  }
  if (mainWindowStartupFallbackTimer) {
    clearTimeout(mainWindowStartupFallbackTimer);
    mainWindowStartupFallbackTimer = null;
  }
  store.setPrivateCollectionEnabled(false);
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
    return focusNoteWindow(existingWindow, nextPayload).then(() => true);
  }

  const noteWindow = createNoteWindow(windowKey, nextPayload);
  return focusNoteWindow(noteWindow, nextPayload).then(() => true);
});

ipcMain.handle('app:show-flashcard-note', (_event, payload) => {
  const nextPayload = normalizeNotePayload({
    ...(typeof payload === 'string' ? { noteId: payload } : payload),
    windowRole: 'flashcard'
  });
  const windowKey = getNoteWindowKey(nextPayload);
  closeFlashcardWindowIfNeeded(windowKey);
  const existingWindow = noteWindows.get(windowKey);
  if (existingWindow && !existingWindow.isDestroyed()) {
    activeFlashcardWindowKey = windowKey;
    return focusNoteWindow(existingWindow, nextPayload).then(() => true);
  }

  const noteWindow = createNoteWindow(windowKey, nextPayload);
  activeFlashcardWindowKey = windowKey;
  return focusNoteWindow(noteWindow, nextPayload).then(() => true);
});

ipcMain.handle('app:update-note-window-context', (event, payload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return false;
  const nextNoteId = payload?.noteId;
  if (!nextNoteId) return false;
  const windowRole = payload?.windowRole || senderWindow.__windowRole || 'default';
  const nextKey = windowRole === 'flashcard' ? `flashcard:note:${nextNoteId}` : `note:${nextNoteId}`;
  const previousKey = senderWindow.__noteKey;
  if (previousKey && previousKey !== nextKey) {
    noteWindows.delete(previousKey);
  }
  senderWindow.__noteKey = nextKey;
  senderWindow.__noteId = nextNoteId;
  senderWindow.__windowRole = windowRole;
  senderWindow.__notePayload = { noteId: nextNoteId, mode: payload?.mode || 'edit', windowRole };
  noteWindows.set(nextKey, senderWindow);
  if (windowRole === 'flashcard') {
    activeFlashcardWindowKey = nextKey;
  }
  return true;
});

ipcMain.handle('app:show-quicknote', () => showQuicknote());
ipcMain.handle('app:hide-quicknote', () => {
  if (quicknoteWindow && !quicknoteWindow.isDestroyed()) quicknoteWindow.close();
});
ipcMain.handle('app:hide-note', event => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return false;
  if (activeFlashcardWindowKey === senderWindow.__noteKey) {
    activeFlashcardWindowKey = '';
  }
  noteWindows.delete(senderWindow.__noteKey);
  senderWindow.destroy();
  setTimeout(() => {
    focusTopRemainingNote(senderWindow);
  }, 0);
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
ipcMain.handle('app:close-main', event => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.close();
    return true;
  }
  return false;
});
ipcMain.handle('app:toggle-main-expanded', event => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return false;
  if (senderWindow.isMaximized()) {
    senderWindow.unmaximize();
    applyMainWindowNormalLayout(senderWindow);
    return { expanded: false };
  }
  senderWindow.webContents.setZoomFactor(1);
  senderWindow.maximize();
  return { expanded: true };
});
ipcMain.handle('app:open-data-path', async () => {
  const result = await shell.openPath(store.getDataDir());
  return result === '';
});
ipcMain.handle('app:resolve-asset-path', (_event, relativePath) => store.resolveAssetPath(relativePath));
ipcMain.handle('app:set-note-pin', (event, isPinned) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.__isPinned = !!isPinned;
    senderWindow.setAlwaysOnTop(!!isPinned, !!isPinned ? 'floating' : 'normal');
    if (!isPinned && shouldKeepNotesFloating()) {
      setNoteWindowFloating(senderWindow, true);
    }
    return true;
  }
  return false;
});
ipcMain.handle('app:show-image-viewer', (event, payload) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  const nextPayload = {
    ...payload,
    sourceWebContentsId: event.sender.id,
    sourceWindowId: sourceWindow?.id || null
  };
  return showImageViewer(nextPayload);
});
ipcMain.handle('app:hide-image-viewer', () => {
  if (imageViewerWindow) imageViewerWindow.hide();
});
ipcMain.handle('app:show-image-viewer-context-menu', (event, payload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const targetPath = String(payload?.path || '').trim();
  if (!senderWindow || !targetPath) return false;
  const menu = Menu.buildFromTemplate([
    {
      label: '复制图片',
      click: () => {
        const resolvedPath = store.resolveAssetPath(targetPath);
        const image = nativeImage.createFromPath(resolvedPath);
        if (!image.isEmpty()) {
          clipboard.writeImage(image);
        }
      }
    }
  ]);
  menu.popup({ window: senderWindow });
  return true;
});
ipcMain.handle('app:fit-image-viewer-window', (_event, payload) => fitImageViewerWindow(payload));
ipcMain.handle('app:update-image-viewer-remark', (_event, payload) => {
  if (!imageViewerWindow || imageViewerWindow.isDestroyed()) return false;
  const viewerPayload = imageViewerWindow.__viewerPayload || {};
  const images = Array.isArray(viewerPayload.images) ? viewerPayload.images : [];
  const targetIndex = Number(payload?.index);
  const targetPath = payload?.path;
  const nextRemark = String(payload?.remark || '');
  const targetItem = Number.isInteger(targetIndex) ? images[targetIndex] : null;
  if (targetItem && targetItem.path === targetPath) {
    targetItem.remark = nextRemark;
  }
  const persisted = store.updateImageAttachmentRemark(targetPath, nextRemark);
  const sourceContents = webContents.fromId(viewerPayload.sourceWebContentsId);
  if (sourceContents && !sourceContents.isDestroyed()) {
    sourceContents.send('image-viewer:remark-updated', {
      path: targetPath,
      remark: nextRemark,
      index: targetIndex
    });
  }
  if (persisted) {
    broadcast('data:updated');
  }
  return true;
});

ipcMain.handle('data:get', () => store.getData());
ipcMain.handle('data:search', (_event, payload) => store.searchNotes(payload));
ipcMain.handle('data:get-config', () => store.getConfig());
ipcMain.handle('data:save-config', (_event, config) => {
  const saved = store.saveConfig(config);
  registerShortcut();
  return saved;
});
ipcMain.handle('data:choose-storage-path', async () => {
  const result = await dialog.showOpenDialog({
    defaultPath: store.getDataDir(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) {
    return { status: 'canceled', dataDir: store.getDataDir() };
  }
  const changed = store.changeDataDir(result.filePaths[0]);
  if (changed.status === 'changed') {
    registerShortcut();
    broadcast('data:updated');
  }
  return changed;
});
ipcMain.handle('data:get-private-state', () => store.getPrivateCollectionState());
ipcMain.handle('data:ensure-private-collection', () => {
  const collection = store.ensurePrivateCollection();
  broadcast('data:updated');
  return collection;
});
ipcMain.handle('data:set-private-enabled', (_event, enabled) => {
  const state = store.setPrivateCollectionEnabled(enabled);
  broadcast('data:updated');
  return state;
});
ipcMain.handle('data:set-private-password', (_event, password) => {
  const result = store.setPrivateCollectionPassword(password);
  if (result) {
    broadcast('data:updated');
  }
  return result;
});
ipcMain.handle('data:verify-private-password', (_event, password) => {
  return store.verifyPrivateCollectionPassword(password);
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
ipcMain.handle('data:export-note-image', async (_event, noteId) => {
  const exportPath = await dialog.showSaveDialog({
    defaultPath: path.join(store.getDataDir(), `QuickNote_${Date.now()}.png`),
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });
  if (exportPath.canceled || !exportPath.filePath) return null;
  const note = store.getData().notes.find(item => item.id === noteId);
  if (!note) return null;
  const savedPath = await exportNoteAsImage(note, exportPath.filePath);
  const image = nativeImage.createFromPath(savedPath);
  if (!image.isEmpty()) {
    clipboard.writeImage(image);
  }
  return savedPath;
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
ipcMain.handle('data:update-collection-orders', (_event, payload) => {
  const result = store.updateCollectionOrders(payload);
  broadcast('data:updated');
  return result;
});
ipcMain.handle('data:create-backup', () => store.createBackup());
ipcMain.handle('data:import-backup', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'QuickNote Backup', extensions: ['zip'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const importedPath = store.importBackup(result.filePaths[0]);
  if (!importedPath) return null;
  registerShortcut();
  broadcast('data:updated');
  return result.filePaths[0];
});
ipcMain.handle('data:export-notes', async (_event, noteIds) => {
  const result = await dialog.showSaveDialog({
    defaultPath: path.join(store.getDataDir(), `QuickNote_${Date.now()}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, store.exportNotes(noteIds), 'utf-8');
  return result.filePath;
});
ipcMain.handle('data:save-image', (_event, payload) => {
  const imagePayload = payload?.buffer ? payload : { buffer: payload, extension: 'png' };
  const processed = processImageAsset(imagePayload.buffer, imagePayload.extension || 'png');
  return store.saveImageAssetSet(processed);
});
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
