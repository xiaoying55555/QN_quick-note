const { contextBridge, ipcRenderer, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const invokeChannels = new Set([
  'app:get-path',
  'app:get-note-window-payload',
  'app:show-note',
  'app:show-quicknote',
  'app:hide-quicknote',
  'app:submit-ocr-selection',
  'app:cancel-ocr-selection',
  'app:hide-note',
  'app:update-note-window-context',
  'app:resize-note-window',
  'app:minimize-main',
  'app:toggle-main-expanded',
  'app:open-data-path',
  'app:set-note-pin',
  'app:show-image-viewer',
  'app:hide-image-viewer',
  'data:get',
  'data:search',
  'data:get-config',
  'data:save-config',
  'data:get-private-state',
  'data:ensure-private-collection',
  'data:set-private-enabled',
  'data:set-private-password',
  'data:verify-private-password',
  'data:create-note',
  'data:create-collection',
  'data:rename-collection',
  'data:delete-collection',
  'data:delete-notes',
  'data:export-note-image',
  'data:move-notes',
  'data:append-note',
  'data:update-note',
  'data:update-orders',
  'data:update-collection-orders',
  'data:create-backup',
  'data:import-backup',
  'data:export-notes',
  'data:save-image',
  'data:save-audio',
  'dialog:open-image'
]);

const listenChannels = new Set(['data:updated', 'quicknote:show', 'note:open', 'image-viewer:open']);

const bridge = {
  invoke(channel, payload) {
    if (!invokeChannels.has(channel)) {
      throw new Error(`Blocked IPC invoke: ${channel}`);
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, callback) {
    if (!listenChannels.has(channel)) {
      throw new Error(`Blocked IPC listen: ${channel}`);
    }
    const listener = (_event, payload) => callback(payload);
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

contextBridge.exposeInMainWorld('quickNoteAPI', bridge);
contextBridge.exposeInMainWorld('api', bridge);
