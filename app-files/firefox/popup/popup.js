/**
 * Popup controls. The background script owns all persistent writes.
 */
const api = globalThis.browser ?? globalThis.chrome;

let prefs = { enabled: true, greyStrength: 75 };
let confirmedPrefs = { ...prefs };
let activeTabId = null;
let pendingSave = null;
let saveTask = null;
let stateRefreshTimer = null;

const controls = {
  enabled: document.getElementById('enabled-toggle'),
  slider: document.getElementById('strength-slider'),
  strength: document.getElementById('strength-input'),
  strengthValue: document.getElementById('strength-value'),
  greyCount: document.getElementById('grey-count'),
  totalSeen: document.getElementById('total-seen'),
  reset: document.getElementById('reset-btn'),
  status: document.getElementById('status-message')
};

async function request(type, details = {}) {
  const response = await api.runtime.sendMessage({ type, ...details });
  if (!response?.ok) {
    throw new Error(response?.error || 'The extension could not complete the request.');
  }
  return response;
}

function showStatus(message, isError = false) {
  controls.status.textContent = message;
  controls.status.classList.toggle('error', isError);
}

function renderPrefs() {
  controls.enabled.checked = prefs.enabled;
  controls.slider.value = String(prefs.greyStrength);
  controls.strength.value = String(prefs.greyStrength);
  controls.strengthValue.textContent = `${prefs.greyStrength}%`;
  document.body.classList.toggle('disabled', !prefs.enabled);
  controls.slider.disabled = !prefs.enabled;
  controls.strength.disabled = !prefs.enabled;
}

function setStrength(value) {
  const parsed = Number.parseInt(value, 10);
  prefs.greyStrength = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
  renderPrefs();
  queueSave();
}

function queueSave() {
  pendingSave = { ...prefs };
  if (!saveTask) {
    saveTask = drainSaves();
  }
}

async function drainSaves() {
  try {
    while (pendingSave) {
      const next = pendingSave;
      pendingSave = null;
      const response = await request('SAVE_PREFS', { prefs: next });
      confirmedPrefs = { ...response.prefs };
      if (!pendingSave) {
        prefs = { ...confirmedPrefs };
        renderPrefs();
      }
    }
    showStatus('');
  } catch (error) {
    pendingSave = null;
    prefs = { ...confirmedPrefs };
    renderPrefs();
    showStatus(`Could not save settings: ${error.message}`, true);
  } finally {
    saveTask = null;
    if (pendingSave) queueSave();
  }
}

async function refreshState() {
  const state = await request('GET_STATE');
  controls.totalSeen.textContent = String(state.seenVideoIds.length);
  if (!saveTask) {
    prefs = { ...state.prefs };
    confirmedPrefs = { ...prefs };
    renderPrefs();
  }
}

function scheduleStateRefresh() {
  if (stateRefreshTimer) clearTimeout(stateRefreshTimer);
  stateRefreshTimer = setTimeout(() => {
    stateRefreshTimer = null;
    refreshState().catch(error => showStatus(`Could not refresh history: ${error.message}`, true));
  }, 100);
}

async function refreshTabCount() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  if (activeTabId === null || !tab?.url?.startsWith('https://www.youtube.com/')) {
    controls.greyCount.textContent = '0';
    return;
  }
  const result = await request('GET_TAB_COUNT', { tabId: activeTabId });
  controls.greyCount.textContent = String(result.count);
}

async function resetHistory() {
  controls.reset.disabled = true;
  showStatus('Resetting history…');
  try {
    if (saveTask) await saveTask;
    await request('RESET_SEEN_VIDEOS');
    await refreshState();
    await refreshTabCount();
    showStatus('History reset.');
  } catch (error) {
    showStatus(`Could not reset history: ${error.message}`, true);
  } finally {
    controls.reset.disabled = false;
  }
}

async function init() {
  await refreshState();
  await refreshTabCount();

  controls.enabled.addEventListener('change', () => {
    prefs.enabled = controls.enabled.checked;
    renderPrefs();
    queueSave();
  });
  controls.slider.addEventListener('input', () => setStrength(controls.slider.value));
  controls.strength.addEventListener('input', () => setStrength(controls.strength.value));
  controls.strength.addEventListener('blur', renderPrefs);
  controls.reset.addEventListener('click', resetHistory);

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.prefs || Object.keys(changes).some(key => key.startsWith('seenChunk') || key === 'seenManifest' || key === 'historyGeneration')) {
      scheduleStateRefresh();
    }
  });

  api.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'GREY_COUNT_UPDATE' && sender.tab?.id === activeTabId) {
      controls.greyCount.textContent = String(message.count);
    }
  });
}

init().catch(error => showStatus(`Could not load extension state: ${error.message}`, true));
