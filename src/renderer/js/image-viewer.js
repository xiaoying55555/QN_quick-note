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
const viewerRemarkInput = document.getElementById('viewerRemarkInput');
const viewerCanvas = document.querySelector('.viewer-canvas');
const viewerPanSurface = document.getElementById('viewerPanSurface');

let imageItems = [];
let currentIndex = 0;
let suppressRemarkSync = false;
let remarkSyncTimer = null;
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isDraggingImage = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOriginX = 0;
let dragOriginY = 0;

function prepareForNextImage() {
  resetPan();
  viewerImage.style.opacity = '0';
  viewerImage.removeAttribute('src');
}

function getCurrentItem() {
  return imageItems[currentIndex] || null;
}

function canDragImage() {
  return zoomLevel > 1.001;
}

function updateCanvasInteractionState() {
  if (!viewerCanvas) return;
  viewerCanvas.classList.toggle('is-draggable', canDragImage() && !isDraggingImage);
  viewerCanvas.classList.toggle('is-dragging', isDraggingImage);
}

function applyPan() {
  if (!viewerPanSurface) return;
  viewerPanSurface.style.transform = `translate3d(${panX}px, ${panY}px, 0)`;
  updateCanvasInteractionState();
}

function applyZoom() {
  viewerImage.style.transform = `scale(${zoomLevel.toFixed(3)})`;
  if (!canDragImage()) {
    panX = 0;
    panY = 0;
    isDraggingImage = false;
    applyPan();
    return;
  }
  updateCanvasInteractionState();
}

function resetPan() {
  panX = 0;
  panY = 0;
  isDraggingImage = false;
  applyPan();
}

function scheduleRemarkSync() {
  const currentItem = getCurrentItem();
  if (!currentItem) return;
  clearTimeout(remarkSyncTimer);
  remarkSyncTimer = window.setTimeout(() => {
    remarkSyncTimer = null;
    api.invoke('app:update-image-viewer-remark', {
      index: currentIndex,
      path: currentItem.path,
      remark: viewerRemarkInput.value
    });
  }, 120);
}

function flushRemarkSync() {
  const currentItem = getCurrentItem();
  if (!currentItem) return;
  clearTimeout(remarkSyncTimer);
  remarkSyncTimer = null;
  api.invoke('app:update-image-viewer-remark', {
    index: currentIndex,
    path: currentItem.path,
    remark: viewerRemarkInput.value
  });
}

function fitViewerToImage() {
  const naturalWidth = viewerImage.naturalWidth || 0;
  const naturalHeight = viewerImage.naturalHeight || 0;
  if (!naturalWidth || !naturalHeight) return;
  api.invoke('app:fit-image-viewer-window', {
    imageWidth: naturalWidth,
    imageHeight: naturalHeight,
    hasRemark: true
  });
}

function clampZoom(nextZoom) {
  return Math.min(3, Math.max(0.2, nextZoom));
}

function resetZoom() {
  zoomLevel = 1;
  resetPan();
  applyZoom();
}

async function renderCurrentImage() {
  if (!imageItems.length) {
    prepareForNextImage();
    viewerCount.textContent = '0 / 0';
    suppressRemarkSync = true;
    viewerRemarkInput.value = '';
    suppressRemarkSync = false;
    viewerRemarkInput.disabled = true;
    prevImageBtn.disabled = true;
    nextImageBtn.disabled = true;
    return;
  }
  const safeIndex = Math.max(0, Math.min(currentIndex, imageItems.length - 1));
  currentIndex = safeIndex;
  const currentItem = imageItems[currentIndex];
  prepareForNextImage();
  viewerImage.src = await api.resolveAssetUrl(currentItem.path);
  resetZoom();
  viewerCount.textContent = `${currentIndex + 1} / ${imageItems.length}`;
  suppressRemarkSync = true;
  viewerRemarkInput.value = currentItem.remark || '';
  suppressRemarkSync = false;
  viewerRemarkInput.disabled = false;
  prevImageBtn.disabled = currentIndex === 0;
  nextImageBtn.disabled = currentIndex === imageItems.length - 1;
}

function shiftImage(offset) {
  if (!imageItems.length) return;
  currentIndex = Math.max(0, Math.min(currentIndex + offset, imageItems.length - 1));
  renderCurrentImage();
}

prevImageBtn.addEventListener('click', () => {
  shiftImage(-1);
});

nextImageBtn.addEventListener('click', () => {
  shiftImage(1);
});

closeViewerBtn.addEventListener('click', () => {
  flushRemarkSync();
  api.invoke('app:hide-image-viewer');
});

viewerImage.addEventListener('load', () => {
  viewerImage.style.opacity = '1';
  fitViewerToImage();
});

viewerCanvas?.addEventListener('wheel', event => {
  event.preventDefault();
  const direction = event.deltaY < 0 ? 0.12 : -0.12;
  zoomLevel = clampZoom(zoomLevel + direction);
  applyZoom();
}, { passive: false });

viewerCanvas?.addEventListener('mousedown', event => {
  if (event.button !== 0 || !canDragImage()) return;
  event.preventDefault();
  isDraggingImage = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragOriginX = panX;
  dragOriginY = panY;
  updateCanvasInteractionState();
});

window.addEventListener('mousemove', event => {
  if (!isDraggingImage) return;
  panX = dragOriginX + (event.clientX - dragStartX);
  panY = dragOriginY + (event.clientY - dragStartY);
  applyPan();
});

window.addEventListener('mouseup', () => {
  if (!isDraggingImage) return;
  isDraggingImage = false;
  updateCanvasInteractionState();
});

viewerCanvas?.addEventListener('mouseleave', () => {
  if (!isDraggingImage) {
    updateCanvasInteractionState();
  }
});

viewerCanvas?.addEventListener('contextmenu', event => {
  event.preventDefault();
  const currentItem = getCurrentItem();
  if (!currentItem) return;
  api.invoke('app:show-image-viewer-context-menu', {
    path: currentItem.path
  });
});

viewerRemarkInput?.addEventListener('input', () => {
  if (suppressRemarkSync) return;
  const currentItem = getCurrentItem();
  if (!currentItem) return;
  currentItem.remark = viewerRemarkInput.value;
  scheduleRemarkSync();
});

document.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') {
    shiftImage(-1);
  }
  if (event.key === 'ArrowRight') {
    shiftImage(1);
  }
  if (event.key === 'Escape') {
    flushRemarkSync();
    api.invoke('app:hide-image-viewer');
  }
});

window.addEventListener('beforeunload', () => {
  flushRemarkSync();
});

api.on('image-viewer:open', payload => {
  imageItems = (payload?.images || []).map(item => (
    typeof item === 'string'
      ? { path: item, remark: '' }
      : { path: item.path, remark: item.remark || '' }
  )).filter(item => item.path);
  currentIndex = payload?.index || 0;
  resetPan();
  renderCurrentImage();
});

window.__prepareImageViewerOpen = prepareForNextImage;
