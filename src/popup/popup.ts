// Popup script for Tweet Heat Map extension
// Handles the on/off toggle and keyword management

import { Keyword, getNextKeywordColor } from '../utils.js';

interface Settings {
  enabled: boolean;
}

const SETTINGS_KEY = 'thm-settings';
const KEYWORDS_KEY = 'thm-keywords';

/**
 * Send a message to the content script to trigger immediate refresh
 */
async function triggerContentRefresh(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.tabs.sendMessage(tab.id, { action: 'forceRefresh' });
    }
  } catch (error) {
    console.debug('Could not send refresh message to content script:', error);
  }
}

/**
 * Force a storage change event to trigger content script refresh
 */
async function triggerStorageRefresh(): Promise<void> {
  try {
    // Get current settings
    const settings = await loadSettings();
    // Save them again to trigger storage listener
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  } catch (error) {
    console.debug('Could not trigger storage refresh:', error);
  }
}

/**
 * Manual refresh function that uses multiple methods
 */
async function performManualRefresh(): Promise<void> {
  // Try direct message first
  await triggerContentRefresh();
  // Fallback to storage trigger
  await triggerStorageRefresh();
}

/**
 * Load current settings from chrome.storage
 */
async function loadSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.sync.get([SETTINGS_KEY]);
    return result[SETTINGS_KEY] || { enabled: true };
  } catch (error) {
    console.error('Error loading settings:', error);
    return { enabled: true };
  }
}

/**
 * Save settings to chrome.storage
 */
async function saveSettings(settings: Settings): Promise<void> {
  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

/**
 * Load keywords from chrome.storage
 */
async function loadKeywords(): Promise<Keyword[]> {
  try {
    const result = await chrome.storage.sync.get([KEYWORDS_KEY]);
    return result[KEYWORDS_KEY] || [];
  } catch (error) {
    console.error('Error loading keywords:', error);
    return [];
  }
}

/**
 * Save keywords to chrome.storage
 */
async function saveKeywords(keywords: Keyword[]): Promise<void> {
  try {
    await chrome.storage.sync.set({ [KEYWORDS_KEY]: keywords });
  } catch (error) {
    console.error('Error saving keywords:', error);
  }
}

/**
 * Update the toggle UI state
 */
function updateToggleUI(enabled: boolean): void {
  const toggle = document.getElementById('enabled-toggle') as HTMLInputElement;
  if (toggle) {
    toggle.checked = enabled;
  }
}

/**
 * Handle toggle change
 */
async function handleToggleChange(event: Event): Promise<void> {
  const toggle = event.target as HTMLInputElement;
  const settings: Settings = {
    enabled: toggle.checked
  };
  
  await saveSettings(settings);
  
  // Trigger immediate refresh
  await triggerContentRefresh();
  
  // Update badge icon to reflect state (optional enhancement)
  try {
    await chrome.action.setIcon({
      path: settings.enabled ? 'icons/icon128.png' : 'icons/icon128-disabled.png'
    });
  } catch (error) {
    // Icon change is optional, don't fail if it doesn't work
    console.debug('Could not update icon:', error);
  }
}

/**
 * Render the keyword list in the UI
 */
function renderKeywords(keywords: Keyword[]): void {
  const keywordList = document.getElementById('keyword-list');
  if (!keywordList) return;
  
  keywordList.innerHTML = '';
  
  keywords.forEach((keyword, index) => {
    const item = document.createElement('div');
    item.className = 'keyword-item';
    
    item.innerHTML = `
      <span class="keyword-text">${keyword.text}</span>
      <div class="keyword-color" style="background-color: ${keyword.color}"></div>
      <button class="btn-remove" data-index="${index}">×</button>
    `;
    
    keywordList.appendChild(item);
  });
}

/**
 * Add a new keyword
 */
async function addKeyword(text: string): Promise<void> {
  const trimmedText = text.trim().toLowerCase();
  if (!trimmedText) return;
  
  const keywords = await loadKeywords();
  
  // Check if keyword already exists
  if (keywords.some(k => k.text.toLowerCase() === trimmedText)) {
    return;
  }
  
  const newKeyword: Keyword = {
    text: trimmedText,
    color: getNextKeywordColor(keywords),
    enabled: true
  };
  
  keywords.push(newKeyword);
  await saveKeywords(keywords);
  renderKeywords(keywords);
  
  // Trigger immediate refresh
  await triggerContentRefresh();
}

/**
 * Remove a keyword by index
 */
async function removeKeyword(index: number): Promise<void> {
  const keywords = await loadKeywords();
  keywords.splice(index, 1);
  await saveKeywords(keywords);
  renderKeywords(keywords);
  
  // Trigger immediate refresh
  await triggerContentRefresh();
}

/**
 * Handle keyword input form submission
 */
async function handleKeywordSubmit(): Promise<void> {
  const input = document.getElementById('keyword-input') as HTMLInputElement;
  if (!input) return;
  
  await addKeyword(input.value);
  input.value = '';
}

/**
 * Set up keyword management event listeners
 */
function setupKeywordListeners(): void {
  // Add keyword button
  const addBtn = document.getElementById('add-keyword');
  if (addBtn) {
    addBtn.addEventListener('click', handleKeywordSubmit);
  }
  
  // Refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await performManualRefresh();
      
      // Visual feedback
      const icon = refreshBtn.querySelector('.refresh-icon');
      if (icon) {
        icon.textContent = '✓';
        setTimeout(() => {
          icon.textContent = '⟳';
        }, 1000);
      }
    });
  }
  
  // Enter key in input
  const input = document.getElementById('keyword-input') as HTMLInputElement;
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleKeywordSubmit();
      }
    });
  }
  
  // Remove keyword buttons (delegated)
  const keywordList = document.getElementById('keyword-list');
  if (keywordList) {
    keywordList.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('btn-remove')) {
        const index = parseInt(target.getAttribute('data-index') || '0');
        await removeKeyword(index);
      }
    });
  }
}

/**
 * Initialize the popup
 */
async function initPopup(): Promise<void> {
  try {
    // Load current settings and keywords
    const settings = await loadSettings();
    const keywords = await loadKeywords();
    
    // Update UI
    updateToggleUI(settings.enabled);
    renderKeywords(keywords);
    
    // Set up toggle listener
    const toggle = document.getElementById('enabled-toggle') as HTMLInputElement;
    if (toggle) {
      toggle.addEventListener('change', handleToggleChange);
    }
    
    // Set up keyword management
    setupKeywordListeners();
    
    // Trigger refresh on popup open to ensure current page is up to date
    await triggerContentRefresh();
    
    console.debug('Popup initialized');
  } catch (error) {
    console.error('Error initializing popup:', error);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
} 