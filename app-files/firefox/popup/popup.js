/**
 * Popup UI controller
 */
import { getPrefs, savePrefs, getSeenCount } from '../lib/storage.js';

let greyCount = 0;
let isInitialized = false;

async function init() {
  if (isInitialized) return;
  isInitialized = true;
  
  // Load preferences
  const prefs = await getPrefs();
  
  // Initialize toggle
  const enabledToggle = document.getElementById('enabled-toggle');
  enabledToggle.checked = prefs.enabled;
  
  // Initialize slider
  const strengthSlider = document.getElementById('strength-slider');
  const strengthValue = document.getElementById('strength-value');
  const strengthInput = document.getElementById('strength-input');
  strengthSlider.value = prefs.greyStrength;
  strengthValue.textContent = `${prefs.greyStrength}%`;
  strengthInput.value = prefs.greyStrength;
  
  // Update disabled state
  updateDisabledState(!prefs.enabled);
  
  // Load counts
  await updateCounts();
  
  // Set up event listeners
  setupEventListeners();
  
  // Listen for storage changes
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.prefs) {
      const newPrefs = changes.prefs.newValue || prefs;
      enabledToggle.checked = newPrefs.enabled;
      strengthSlider.value = newPrefs.greyStrength;
      strengthValue.textContent = `${newPrefs.greyStrength}%`;
      strengthInput.value = newPrefs.greyStrength;
      updateDisabledState(!newPrefs.enabled);
    }
  });
  
  // Listen for grey count updates from content script
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'GREY_COUNT_UPDATE') {
      greyCount = message.count;
      updateCounts();
    }
  });
}

function setupEventListeners() {
  const enabledToggle = document.getElementById('enabled-toggle');
  const strengthSlider = document.getElementById('strength-slider');
  const strengthInput = document.getElementById('strength-input');
  const strengthValue = document.getElementById('strength-value');
  const resetBtn = document.getElementById('reset-btn');

  // Toggle change
  enabledToggle.addEventListener('change', async () => {
    const prefs = await getPrefs();
    prefs.enabled = enabledToggle.checked;
    await savePrefs(prefs);
    updateDisabledState(!prefs.enabled);

    // Notify all YouTube tabs
    notifyAllTabs(prefs);
  });

  // Helper to update all controls
  const updateStrengthControls = (value) => {
    const numValue = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
    strengthSlider.value = numValue;
    strengthInput.value = numValue;
    strengthValue.textContent = `${numValue}%`;
    return numValue;
  };

  // Slider input (real-time updates)
  strengthSlider.addEventListener('input', async () => {
    const value = updateStrengthControls(strengthSlider.value);

    // Save prefs
    const prefs = await getPrefs();
    prefs.greyStrength = value;
    await savePrefs(prefs);

    // Notify all YouTube tabs immediately (real-time)
    notifyAllTabs(prefs);
  });

  // Number input
  strengthInput.addEventListener('input', async () => {
    const value = updateStrengthControls(strengthInput.value);

    // Save prefs
    const prefs = await getPrefs();
    prefs.greyStrength = value;
    await savePrefs(prefs);

    // Notify all YouTube tabs immediately (real-time)
    notifyAllTabs(prefs);
  });

  // Number input blur - ensure valid value
  strengthInput.addEventListener('blur', () => {
    updateStrengthControls(strengthInput.value);
  });
  
  // Reset button
  resetBtn.addEventListener('click', async () => {
    resetBtn.textContent = '⏳ Resetting...';
    resetBtn.disabled = true;
    
    try {
      // Clear storage
      await clearAllSeenVideos();
      
      // Notify all tabs to refresh
      const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
      for (const tab of tabs) {
        try {
          await browser.tabs.sendMessage(tab.id, { type: 'RESET_SEEN_VIDEOS' });
        } catch (e) {
          // Tab might not have content script loaded yet
        }
      }
      
      // Update UI
      greyCount = 0;
      await updateCounts();
      
      resetBtn.textContent = '✅ Reset Complete!';
      setTimeout(() => {
        resetBtn.textContent = '🗑️ Reset History';
        resetBtn.disabled = false;
      }, 2000);
    } catch (e) {
      console.error('[Popup] Reset failed:', e);
      resetBtn.textContent = '❌ Reset Failed';
      setTimeout(() => {
        resetBtn.textContent = '🗑️ Reset History';
        resetBtn.disabled = false;
      }, 2000);
    }
  });
}

/**
 * Clear all seen videos from storage
 */
async function clearAllSeenVideos() {
  try {
    const result = await browser.storage.local.get(null);
    const keysToDelete = Object.keys(result).filter(k => 
      k.startsWith('seenChunk') || 
      k === 'seenManifest' || 
      k === 'watchIntent'
    );
    
    if (keysToDelete.length > 0) {
      await browser.storage.local.remove(keysToDelete);
      console.log('[Popup] Cleared', keysToDelete.length, 'storage keys');
    }
  } catch (e) {
    console.error('[Popup] Failed to clear storage:', e);
    throw e;
  }
}

/**
 * Notify all YouTube tabs of preference changes
 */
async function notifyAllTabs(prefs) {
  try {
    const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
    for (const tab of tabs) {
      try {
        await browser.tabs.sendMessage(tab.id, {
          type: 'PREFS_CHANGED',
          prefs
        });
      } catch (e) {
        // Tab might not have content script loaded yet
      }
    }
  } catch (e) {
    console.error('[Popup] Failed to notify tabs:', e);
  }
}

function updateDisabledState(disabled) {
  if (disabled) {
    document.body.classList.add('disabled');
  } else {
    document.body.classList.remove('disabled');
  }
}

async function updateCounts() {
  const greyCountEl = document.getElementById('grey-count');
  const totalSeenEl = document.getElementById('total-seen');
  
  greyCountEl.textContent = greyCount;
  
  const totalSeen = await getSeenCount();
  totalSeenEl.textContent = totalSeen;
}

// Initialize on load
init().catch(console.error);
