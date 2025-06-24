// Tweet Heat Map - Content Script
// Color-codes tweets by view-count and flags fresh ones with 🔥

import { parseViews, Keyword, highlightKeywords, removeKeywordHighlights } from './utils.js';

interface Settings {
  enabled: boolean;
}

// Color thresholds as defined in PRD
const VIEW_THRESHOLDS = [
  { min: 0, max: 3000, className: 'views-0' },
  { min: 3001, max: 15000, className: 'views-1' },
  { min: 15001, max: 75000, className: 'views-2' },
  { min: 75001, max: 300000, className: 'views-3' },
  { min: 300001, max: Infinity, className: 'views-4' },
];

// CSS for the heat map colors - Cold to Hot progression
const HEAT_MAP_CSS = `
  .views-1::before { content: ''; position: absolute; left: 0; top: 30px; bottom: 0px; width: 5px; background: #4A90E2; z-index: 10; }
  .views-2::before { content: ''; position: absolute; left: 0; top: 30px; bottom: 0px; width: 5px; background: #F39C12; z-index: 10; }
  .views-3::before { content: ''; position: absolute; left: 0; top: 30px; bottom: 0px; width: 5px; background: #E67E22; z-index: 10; }
  .views-4::before { content: ''; position: absolute; left: 0; top: 30px; bottom: 0px; width: 5px; background: #E74C3C; z-index: 10; }
  .views-1, .views-2, .views-3, .views-4 { position: relative; }
`;

let settings: Settings = { enabled: true };
let keywords: Keyword[] = [];
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

function getTargetContainer(articleEl: HTMLElement): HTMLElement {
  // Twitter wraps each <article> in a div that tends not to get replaced on
  // hover.  Using the parent keeps our class from being stripped during
  // dynamic re-renders.
  return (articleEl.parentElement as HTMLElement) || articleEl;
}

/**
 * Apply heat map styling and keyword highlighting to a tweet article element
 */
function applyHeat(articleEl: HTMLElement): void {
  if (!settings.enabled) return;

  try {
    const targetEl = getTargetContainer(articleEl);

    // Heat map styling
    const viewsElement = articleEl.querySelector(
      'a[aria-label*=" views" i], [data-testid="viewCount"]'
    );

    if (viewsElement) {
      let rawCount = '';
      const label = viewsElement.getAttribute('aria-label') || '';
      rawCount = label.trim().split(' ')[0];

      const viewCount = parseViews(rawCount);

      if (viewCount === null) {
        return; // Not a parsable number
      }

      // Remove existing view classes
      VIEW_THRESHOLDS.forEach(threshold => {
        targetEl.classList.remove(threshold.className);
      });

      // Add appropriate class
      const className = getViewsClass(viewCount);
      if (className !== 'views-0') {
        targetEl.classList.add(className);
      }
    }

    // Handle fire emoji for fresh tweets
    const timeElement = articleEl.querySelector('time') as HTMLTimeElement;
    if (timeElement) {
      const isFresh = isTweetFresh(timeElement);
      updateFireEmoji(timeElement, isFresh);
    }

    // Apply keyword highlighting to tweet text
    const tweetTextElement = articleEl.querySelector('[data-testid="tweetText"]');
    if (tweetTextElement) {
      // Always remove existing highlights first to ensure clean state
      removeKeywordHighlights(tweetTextElement as HTMLElement);
      
      // Then apply current keywords if any exist
      if (keywords.length > 0) {
        highlightKeywords(tweetTextElement as HTMLElement, keywords);
      }
    }
  } catch (error) {
    // Silent catch
  }
}

/**
 * Remove heat map styling and keyword highlights from a tweet
 */
function removeHeat(articleEl: HTMLElement): void {
  const targetEl = getTargetContainer(articleEl);

  // Remove all view classes
  VIEW_THRESHOLDS.forEach(threshold => {
    targetEl.classList.remove(threshold.className);
  });

  // Remove fire emoji
  const timeElement = articleEl.querySelector('time') as HTMLTimeElement;
  if (timeElement) {
    updateFireEmoji(timeElement, false);
  }

  // Remove keyword highlights
  const tweetTextElement = articleEl.querySelector('[data-testid="tweetText"]');
  if (tweetTextElement) {
    removeKeywordHighlights(tweetTextElement as HTMLElement);
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
 * Force complete refresh of all tweets - removes all effects and reapplies them
 */
function forceCompleteRefresh(): void {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  
  // First pass: completely clean all tweets
  tweets.forEach(tweet => {
    removeHeat(tweet as HTMLElement);
  });
  
  // Second pass: reapply effects if enabled
  if (settings.enabled) {
    tweets.forEach(tweet => {
      applyHeat(tweet as HTMLElement);
    });
  }
}

/**
 * Set up mutation observer to watch for new tweets
 */
function observeNew(): void {
  if (observer) return;

  const targetNode = document.querySelector('main');
  if (!targetNode) return;

  observer = new MutationObserver(mutations => {
    const processChanges = () => {
      mutations.forEach(mutation => {
        // Case 1: New nodes were added to the DOM
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const element = node as Element;
          if (element.matches('article[data-testid="tweet"]')) {
            applyHeat(element as HTMLElement);
          }
          element
            .querySelectorAll('article[data-testid="tweet"]')
            .forEach(tweet => {
              applyHeat(tweet as HTMLElement);
            });
        });

        // Case 2: An attribute changed on a tweet or its child,
        // which can happen when Twitter rewrites classes on hover.
        if (mutation.type === 'attributes') {
          const parentTweet = (mutation.target as Element).closest(
            'article[data-testid="tweet"]'
          );
          if (parentTweet) {
            applyHeat(parentTweet as HTMLElement);
          }
        }
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
    subtree: true,
    attributes: true,
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
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (settings.enabled) {
    injectStyles();
    scanExisting();
    observeNew();
  } else {
    removeStyles();
    scanExisting(); // This will remove heat from existing tweets
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
 * Load keywords from chrome.storage
 */
async function loadKeywords(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get(['thm-keywords']);
    keywords = result['thm-keywords'] || [];
  } catch (error) {
    console.debug('Tweet Heat Map: Error loading keywords', error);
  }
}

/**
 * Listen for settings and keyword changes
 */
function setupStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
      let shouldUpdate = false;
      let keywordsChanged = false;
      
      if (changes['thm-settings']) {
        const newSettings = changes['thm-settings'].newValue;
        if (newSettings) {
          settings = { ...settings, ...newSettings };
          shouldUpdate = true;
        }
      }
      
      if (changes['thm-keywords']) {
        const newKeywords = changes['thm-keywords'].newValue;
        keywords = newKeywords || [];
        keywordsChanged = true;
        shouldUpdate = true;
      }
      
      if (shouldUpdate) {
        if (keywordsChanged) {
          // When keywords change, force complete refresh to ensure clean state
          forceCompleteRefresh();
        } else {
          // For other settings changes, use normal update
          updateExtensionState();
        }
      }
    }
  });
}

/**
 * Listen for messages from popup to trigger immediate refresh
 */
function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'forceRefresh') {
      console.debug('Tweet Heat Map: Received force refresh request from popup');
      
      // Force complete refresh instead of just updateExtensionState
      forceCompleteRefresh();
      
      // Send acknowledgment
      sendResponse({ success: true });
    }
    
    return true; // Keep message channel open for async response
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
 * Initialize the extension by waiting for the main timeline to be ready.
 */
async function init(): Promise<void> {
  await loadSettings();
  await loadKeywords();
  setupStorageListener();
  setupMessageListener();
  setupCleanup();

  const runLogic = () => {
    updateExtensionState();
  };

  // Check if the main element is already there. If so, run.
  // If not, use a MutationObserver to wait for it.
  const mainEl = document.querySelector('main');
  if (mainEl) {
    runLogic();
  } else {
    const initialObserver = new MutationObserver((mutations, obs) => {
      if (document.querySelector('main')) {
        obs.disconnect();
        runLogic();
      }
    });
    initialObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
}

// Start the extension
init().catch(error => {
  console.error('Tweet Heat Map: Initialization failed', error);
}); 