// Popup script for Tweet Heat Map extension
// Handles the on/off toggle and settings storage

interface Settings {
  enabled: boolean;
}

const STORAGE_KEY = 'thm-settings';

/**
 * Load current settings from chrome.storage
 */
async function loadSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.sync.get([STORAGE_KEY]);
    return result[STORAGE_KEY] || { enabled: true };
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
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  } catch (error) {
    console.error('Error saving settings:', error);
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
 * Initialize the popup
 */
async function initPopup(): Promise<void> {
  try {
    // Load current settings
    const settings = await loadSettings();
    
    // Update UI
    updateToggleUI(settings.enabled);
    
    // Set up toggle listener
    const toggle = document.getElementById('enabled-toggle') as HTMLInputElement;
    if (toggle) {
      toggle.addEventListener('change', handleToggleChange);
    }
    
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