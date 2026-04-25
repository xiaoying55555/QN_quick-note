const { ipcRenderer } = require('electron');
const path = require('path');

function stripHtml(input) {
  return input.replace(/<[^>]*>/g, '');
}

async function resolveAssetUrl(relativePath) {
  const dataPath = await ipcRenderer.invoke('app:get-path', 'documents');
  const fullPath = path.join(dataPath, 'QuickNote', relativePath);
  return `file://${fullPath.replace(/\\/g, '/')}`;
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

module.exports = {
  stripHtml,
  resolveAssetUrl,
  formatDuration
};
