// Tweet Heat Map - Content Script
// Color-codes tweets by view-count and flags fresh ones with 🔥

import { parseViews } from './utils.js';

interface Settings {
  enabled: boolean;
}

// Color thresholds as defined in PRD
const VIEW_THRESHOLDS = [
  { min: 0, max: 1000, className: 'views-0' },
  { min: 1001, max: 10000, className: 'views-1' },
  { min: 10001, max: 50000, className: 'views-2' },
  { min: 50001, max: 250000, className: 'views-3' },
];

// CSS for the heat map colors
const HEAT_MAP_CSS = `
  .views-1 { border-right: 5px solid #B4C6FF !important; }
  .views-2 { border-right: 5px solid #BDF4C4 !important; }
  .views-3 { border-right: 5px solid #FFC2C2 !important; }
`;

let settings: Settings = { enabled: true };
let observer: MutationObserver | null = null;
let styleElement: HTMLStyleElement | null = null;



/**
 * Get the appropriate CSS class for a view count
 */
function getViewsClass(viewCount: number): string {
  for (const threshold of VIEW_THRESHOLDS) {
    if (viewCount >= threshold.min && viewCount <= threshold.max) {
      return threshold.className;
    }
  }
  // For counts above our highest threshold, use the highest class
  return VIEW_THRESHOLDS[VIEW_THRESHOLDS.length - 1].className;
}

/**
 * Check if a tweet is fresh (≤ 30 minutes old)
 */
function isTweetFresh(timeElement: HTMLTimeElement): boolean {
  const datetime = timeElement.getAttribute('datetime');
  if (!datetime) return false;
  
  const tweetTime = new Date(datetime);
  const now = new Date();
  const diffMinutes = (now.getTime() - tweetTime.getTime()) / (1000 * 60);
  
  return diffMinutes <= 30;
}

/**
 * Add or remove 🔥 emoji from tweet timestamp
 */
function updateFireEmoji(timeElement: HTMLTimeElement, shouldAdd: boolean): void {
  const textContent = timeElement.textContent || '';
  const hasEmoji = textContent.startsWith('🔥 ');
  
  if (shouldAdd && !hasEmoji) {
    timeElement.textContent = '🔥 ' + textContent;
  } else if (!shouldAdd && hasEmoji) {
    timeElement.textContent = textContent.replace('🔥 ', '');
  }
}

/**
 * Apply heat map styling to a tweet article element
 */
function applyHeat(articleEl: HTMLElement): void {
  if (!settings.enabled) return;
  
  try {
    // Find views element
    const viewsElement = articleEl.querySelector('[aria-label$=" Views"]');
    if (viewsElement) {
      const viewsText = viewsElement.getAttribute('aria-label') || '';
      const viewCount = parseViews(viewsText.replace(' Views', ''));
      
      if (viewCount !== null) {
        // Remove existing view classes
        VIEW_THRESHOLDS.forEach(threshold => {
          articleEl.classList.remove(threshold.className);
        });
        
        // Add appropriate class
        const className = getViewsClass(viewCount);
        if (className !== 'views-0') {
          articleEl.classList.add(className);
        }
      }
    }
    
    // Handle fire emoji for fresh tweets
    const timeElement = articleEl.querySelector('time') as HTMLTimeElement;
    if (timeElement) {
      const isFresh = isTweetFresh(timeElement);
      updateFireEmoji(timeElement, isFresh);
    }
  } catch (error) {
    console.debug('Tweet Heat Map: Error processing tweet', error);
  }
}

/**
 * Remove heat map styling from a tweet
 */
function removeHeat(articleEl: HTMLElement): void {
  // Remove all view classes
  VIEW_THRESHOLDS.forEach(threshold => {
    articleEl.classList.remove(threshold.className);
  });
  
  // Remove fire emoji
  const timeElement = articleEl.querySelector('time') as HTMLTimeElement;
  if (timeElement) {
    updateFireEmoji(timeElement, false);
  }
}

/**
 * Scan existing tweets on the page
 */
function scanExisting(): void {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  tweets.forEach(tweet => {
    if (settings.enabled) {
      applyHeat(tweet as HTMLElement);
    } else {
      removeHeat(tweet as HTMLElement);
    }
  });
}

/**
 * Set up mutation observer to watch for new tweets
 */
function observeNew(): void {
  if (observer) return;
  
  const targetNode = document.querySelector('main');
  if (!targetNode) return;
  
  observer = new MutationObserver((mutations) => {
    // Use requestIdleCallback for throttling if available
    const processChanges = () => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            
            // Check if it's a tweet
            if (element.matches('article[data-testid="tweet"]')) {
              if (settings.enabled) {
                applyHeat(element as HTMLElement);
              }
            }
            
            // Check for tweets within the added node
            const tweets = element.querySelectorAll('article[data-testid="tweet"]');
            tweets.forEach(tweet => {
              if (settings.enabled) {
                applyHeat(tweet as HTMLElement);
              }
            });
          }
        });
      });
    };
    
    if ('requestIdleCallback' in window) {
      requestIdleCallback(processChanges);
    } else {
      setTimeout(processChanges, 0);
    }
  });
  
  observer.observe(targetNode, {
    childList: true,
    subtree: true
  });
}

/**
 * Inject CSS styles into the page
 */
function injectStyles(): void {
  if (styleElement) return;
  
  styleElement = document.createElement('style');
  styleElement.id = 'thm-styles';
  styleElement.textContent = HEAT_MAP_CSS;
  document.head.appendChild(styleElement);
}

/**
 * Remove CSS styles from the page
 */
function removeStyles(): void {
  if (styleElement) {
    styleElement.remove();
    styleElement = null;
  }
}

/**
 * Update extension state based on settings
 */
function updateExtensionState(): void {
  if (settings.enabled) {
    injectStyles();
    scanExisting();
    observeNew();
  } else {
    removeStyles();
    scanExisting(); // This will remove heat from existing tweets
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }
}

/**
 * Load settings from chrome.storage
 */
async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get(['thm-settings']);
    if (result['thm-settings']) {
      settings = { ...settings, ...result['thm-settings'] };
    }
  } catch (error) {
    console.debug('Tweet Heat Map: Error loading settings', error);
  }
}

/**
 * Listen for settings changes
 */
function setupStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes['thm-settings']) {
      const newSettings = changes['thm-settings'].newValue;
      if (newSettings) {
        settings = { ...settings, ...newSettings };
        updateExtensionState();
      }
    }
  });
}

/**
 * Clean up when page unloads
 */
function setupCleanup(): void {
  window.addEventListener('beforeunload', () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });
}

/**
 * Initialize the extension
 */
async function init(): Promise<void> {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    await new Promise(resolve => {
      document.addEventListener('DOMContentLoaded', resolve);
    });
  }
  
  await loadSettings();
  setupStorageListener();
  setupCleanup();
  updateExtensionState();
  
  console.debug('Tweet Heat Map: Initialized');
}

// Start the extension
init().catch(error => {
  console.error('Tweet Heat Map: Initialization failed', error);
}); 