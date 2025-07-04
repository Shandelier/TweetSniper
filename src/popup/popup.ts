// Popup script for Tweet Heat Map extension
// Handles the on/off toggle and keyword management

import { Keyword, getNextKeywordColor } from '../utils.js';

interface Settings {
  enabled: boolean;
  indicatorMode?: 'views' | 'breakout';
  breakoutMaxViews?: number;
  breakoutMaxAge?: number;
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
    return result[SETTINGS_KEY] || { 
      enabled: true, 
      indicatorMode: 'views',
      breakoutMaxViews: 100000,
      breakoutMaxAge: 120
    };
  } catch (error) {
    console.error('Error loading settings:', error);
    return { 
      enabled: true, 
      indicatorMode: 'views',
      breakoutMaxViews: 100000,
      breakoutMaxAge: 120
    };
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
 * Update the mode selector UI state
 */
function updateModeUI(mode: 'views' | 'breakout'): void {
  const viewsRadio = document.getElementById('mode-views') as HTMLInputElement;
  const breakoutRadio = document.getElementById('mode-breakout') as HTMLInputElement;
  
  if (viewsRadio && breakoutRadio) {
    viewsRadio.checked = mode === 'views';
    breakoutRadio.checked = mode === 'breakout';
  }
  
  // Toggle legend visibility
  const viewsLegend = document.getElementById('views-legend');
  const breakoutLegend = document.getElementById('breakout-legend');
  
  if (viewsLegend && breakoutLegend) {
    viewsLegend.style.display = mode === 'views' ? 'block' : 'none';
    breakoutLegend.style.display = mode === 'breakout' ? 'block' : 'none';
  }
}

/**
 * Format views count for display
 */
function formatViews(views: number): string {
  if (views >= 1000000) {
    return `${(views / 1000000).toFixed(1)}M`;
  } else if (views >= 1000) {
    return `${Math.floor(views / 1000)}K`;
  }
  return views.toString();
}

/**
 * Format minutes to hours/minutes
 */
function formatMinutes(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * Update guard rail UI
 */
function updateGuardRailUI(settings: Settings): void {
  const maxViewsSlider = document.getElementById('max-views-slider') as HTMLInputElement;
  const maxAgeSlider = document.getElementById('max-age-slider') as HTMLInputElement;
  const maxViewsValue = document.getElementById('max-views-value');
  const maxAgeValue = document.getElementById('max-age-value');
  
  if (maxViewsSlider && maxViewsValue) {
    maxViewsSlider.value = (settings.breakoutMaxViews || 100000).toString();
    maxViewsValue.textContent = formatViews(settings.breakoutMaxViews || 100000);
  }
  
  if (maxAgeSlider && maxAgeValue) {
    maxAgeSlider.value = (settings.breakoutMaxAge || 120).toString();
    maxAgeValue.textContent = formatMinutes(settings.breakoutMaxAge || 120);
  }
}

/**
 * Handle toggle change
 */
async function handleToggleChange(event: Event): Promise<void> {
  const toggle = event.target as HTMLInputElement;
  const currentSettings = await loadSettings();
  const settings: Settings = {
    ...currentSettings,
    enabled: toggle.checked
  };
  
  await saveSettings(settings);
  
  // Notify content script with multiple approaches for reliability
  await triggerContentRefresh();
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'SETTINGS_CHANGED',
        settings: settings
      });
    }
  } catch (error) {
    console.debug('Could not notify content script:', error);
  }
  
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
 * Handle mode change
 */
async function handleModeChange(event: Event): Promise<void> {
  const radio = event.target as HTMLInputElement;
  const currentSettings = await loadSettings();
  const settings: Settings = {
    ...currentSettings,
    indicatorMode: radio.value as 'views' | 'breakout'
  };
  
  await saveSettings(settings);
  updateModeUI(settings.indicatorMode!);
  
  // Notify content script to repaint timeline
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'MODE_CHANGED',
        indicatorMode: settings.indicatorMode
      });
    }
  } catch (error) {
    // Content script might not be loaded, that's okay
    console.debug('Could not notify content script:', error);
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
 * Handle guard rail changes
 */
async function handleGuardRailChange(): Promise<void> {
  const maxViewsSlider = document.getElementById('max-views-slider') as HTMLInputElement;
  const maxAgeSlider = document.getElementById('max-age-slider') as HTMLInputElement;
  const maxViewsValue = document.getElementById('max-views-value');
  const maxAgeValue = document.getElementById('max-age-value');
  
  const currentSettings = await loadSettings();
  const settings: Settings = {
    ...currentSettings,
    breakoutMaxViews: parseInt(maxViewsSlider.value),
    breakoutMaxAge: parseInt(maxAgeSlider.value)
  };
  
  // Update display values
  if (maxViewsValue) {
    maxViewsValue.textContent = formatViews(settings.breakoutMaxViews!);
  }
  if (maxAgeValue) {
    maxAgeValue.textContent = formatMinutes(settings.breakoutMaxAge!);
  }
  
  await saveSettings(settings);
  
  // Send message to content script to trigger repaint
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.tabs.sendMessage(tab.id, { 
        type: 'settingsChanged',
        settings: settings
      });
    }
  } catch (error) {
    console.debug('Could not send message to content script:', error);
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
    updateModeUI(settings.indicatorMode || 'views');
    updateGuardRailUI(settings);
    renderKeywords(keywords);
    
    // Set up toggle listener
    const toggle = document.getElementById('enabled-toggle') as HTMLInputElement;
    if (toggle) {
      toggle.addEventListener('change', handleToggleChange);
    }
    
    // Set up mode listeners
    const modeRadios = document.querySelectorAll('input[name="indicator-mode"]');
    modeRadios.forEach(radio => {
      radio.addEventListener('change', handleModeChange);
    });
    
    // Set up guard rail sliders
    const maxViewsSlider = document.getElementById('max-views-slider') as HTMLInputElement;
    const maxAgeSlider = document.getElementById('max-age-slider') as HTMLInputElement;
    if (maxViewsSlider) {
      maxViewsSlider.addEventListener('input', handleGuardRailChange);
    }
    if (maxAgeSlider) {
      maxAgeSlider.addEventListener('input', handleGuardRailChange);
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