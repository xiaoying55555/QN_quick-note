const api = (() => {
  if (window.quickNoteAPI) return window.quickNoteAPI;
  if (window.api) return window.api;
  try {
    const { ipcRenderer } = require('electron');
    return {
      invoke(channel, payload) {
        return ipcRenderer.invoke(channel, payload);
      }
    };
  } catch (_error) {
    return {
      invoke() {
        throw new Error('QuickNote bridge unavailable');
      }
    };
  }
})();

const selectionBox = document.getElementById('selectionBox');
let startPoint = null;
let currentRect = null;

function normalizeRect(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { x: left, y: top, width, height };
}

function renderRect(rect) {
  selectionBox.hidden = false;
  selectionBox.style.left = `${rect.x}px`;
  selectionBox.style.top = `${rect.y}px`;
  selectionBox.style.width = `${rect.width}px`;
  selectionBox.style.height = `${rect.height}px`;
}

window.addEventListener('mousedown', event => {
  startPoint = { x: event.clientX, y: event.clientY };
  currentRect = null;
  selectionBox.hidden = true;
});

window.addEventListener('mousemove', event => {
  if (!startPoint) return;
  currentRect = normalizeRect(startPoint.x, startPoint.y, event.clientX, event.clientY);
  renderRect(currentRect);
});

window.addEventListener('mouseup', async event => {
  if (!startPoint) return;
  currentRect = normalizeRect(startPoint.x, startPoint.y, event.clientX, event.clientY);
  startPoint = null;
  if (currentRect.width < 6 || currentRect.height < 6) {
    selectionBox.hidden = true;
    currentRect = null;
    return;
  }
  await api.invoke('app:submit-ocr-selection', currentRect);
  window.close();
});

window.addEventListener('keydown', async event => {
  if (event.key === 'Escape') {
    await api.invoke('app:cancel-ocr-selection');
    window.close();
  }
});
