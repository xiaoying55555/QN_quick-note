const api = (() => {
  if (window.quickNoteAPI) return window.quickNoteAPI;
  if (window.api) return window.api;
  try {
    const { ipcRenderer } = require('electron');
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
      }
    };
  }
})();

const viewerImage = document.getElementById('viewerImage');
const viewerCount = document.getElementById('viewerCount');
const prevImageBtn = document.getElementById('prevImageBtn');
const nextImageBtn = document.getElementById('nextImageBtn');
const closeViewerBtn = document.getElementById('closeViewerBtn');

let imagePaths = [];
let currentIndex = 0;

async function renderCurrentImage() {
  if (!imagePaths.length) {
    viewerImage.removeAttribute('src');
    viewerCount.textContent = '0 / 0';
    prevImageBtn.disabled = true;
    nextImageBtn.disabled = true;
    return;
  }
  const safeIndex = Math.max(0, Math.min(currentIndex, imagePaths.length - 1));
  currentIndex = safeIndex;
  viewerImage.src = await api.resolveAssetUrl(imagePaths[currentIndex]);
  viewerCount.textContent = `${currentIndex + 1} / ${imagePaths.length}`;
  prevImageBtn.disabled = currentIndex === 0;
  nextImageBtn.disabled = currentIndex === imagePaths.length - 1;
}

function shiftImage(offset) {
  if (!imagePaths.length) return;
  currentIndex = Math.max(0, Math.min(currentIndex + offset, imagePaths.length - 1));
  renderCurrentImage();
}

prevImageBtn.addEventListener('click', () => {
  shiftImage(-1);
});

nextImageBtn.addEventListener('click', () => {
  shiftImage(1);
});

closeViewerBtn.addEventListener('click', () => {
  api.invoke('app:hide-image-viewer');
});

document.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') {
    shiftImage(-1);
  }
  if (event.key === 'ArrowRight') {
    shiftImage(1);
  }
  if (event.key === 'Escape') {
    api.invoke('app:hide-image-viewer');
  }
});

api.on('image-viewer:open', payload => {
  imagePaths = payload?.images || [];
  currentIndex = payload?.index || 0;
  renderCurrentImage();
});
