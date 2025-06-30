// Tweet Heat Map - Content Script
// Color-codes tweets by view-count and flags fresh ones with 🔥

import { parseViews, parseCount, Keyword, highlightKeywords, removeKeywordHighlights } from './utils.js';

interface Settings {
  enabled: boolean;
  indicatorMode: 'views' | 'breakout';
  breakoutMaxViews?: number;
  breakoutMaxAge?: number;
}

interface TweetMetrics {
  replies: number;
  reposts: number;
  likes: number;
  views: number;
  ageMin: number;
}

interface TweetState {
  firstSeen: number;
  lastMetrics: TweetMetrics;
  lastSeen: number;
}

// Per-tweet state management
const tweetStats = new Map<string, TweetState>();

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
  
  /* Breakout indicators - thicker bar (7px) for visibility */
  .breakout-hot::before { content: ''; position: absolute; left: 0; top: 30px; bottom: 0px; width: 7px; background: #FF1E1E; z-index: 10; }
  .breakout-warm::before { content: ''; position: absolute; left: 0; top: 30px; bottom: 0px; width: 7px; background: #FFC300; z-index: 10; }
  .breakout-watch::before { content: ''; position: absolute; left: 0; top: 30px; bottom: 0px; width: 7px; background: #4A90E2; z-index: 10; }
  .breakout-hot, .breakout-warm, .breakout-watch { position: relative; }
`;

let settings: Settings = { 
  enabled: true, 
  indicatorMode: 'views',
  breakoutMaxViews: 100000,
  breakoutMaxAge: 120
};
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
 * Extract tweet ID from article element
 */
function getTweetId(articleEl: HTMLElement): string | null {
  const link = articleEl.querySelector('a[href*="/status/"]');
  if (!link) return null;
  
  const href = link.getAttribute('href');
  if (!href) return null;
  
  const match = href.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract engagement metrics from tweet
 */
function extractMetrics(articleEl: HTMLElement): TweetMetrics | null {
  try {
    // Find the group with engagement metrics
    const metricsGroup = articleEl.querySelector('[role="group"][aria-label]');
    if (!metricsGroup) return null;
    
    const ariaLabel = metricsGroup.getAttribute('aria-label') || '';
    
    // Parse engagement metrics from aria-label
    // Format can be: "22 replies, 23 reposts, 360 likes, 22399 views" or
    // "126 comments, 24 retweets, 199 likes, 6186 views"
    const repliesMatch = ariaLabel.match(/(\d+(?:,\d+)*(?:\.\d+)?(?:\s*[KkMmBb])?)\s*(?:repl|comment)/i);
    const repostsMatch = ariaLabel.match(/(\d+(?:,\d+)*(?:\.\d+)?(?:\s*[KkMmBb])?)\s*(?:repost|retweet)/i);
    const likesMatch = ariaLabel.match(/(\d+(?:,\d+)*(?:\.\d+)?(?:\s*[KkMmBb])?)\s*like/i);
    const viewsMatch = ariaLabel.match(/(\d+(?:,\d+)*(?:\.\d+)?(?:\s*[KkMmBb])?)\s*view/i);
    
    const replies = repliesMatch ? parseCount(repliesMatch[1]) || 0 : 0;
    const reposts = repostsMatch ? parseCount(repostsMatch[1]) || 0 : 0;
    const likes = likesMatch ? parseCount(likesMatch[1]) || 0 : 0;
    const views = viewsMatch ? parseCount(viewsMatch[1]) || 0 : 0;
    
    // Calculate tweet age
    const timeElement = articleEl.querySelector('time') as HTMLTimeElement;
    if (!timeElement) return null;
    
    const datetime = timeElement.getAttribute('datetime');
    if (!datetime) return null;
    
    const tweetTime = new Date(datetime);
    const now = new Date();
    const ageMin = Math.max(0, (now.getTime() - tweetTime.getTime()) / (1000 * 60));
    
    return { replies, reposts, likes, views, ageMin };
  } catch (error) {
    return null;
  }
}

/**
 * Calculate breakout score
 */
function getBreakoutScore(metrics: TweetMetrics): number {
  // S = (1.2*R + 1.5*Q + 1.0*L) / (t+1)^1.15
  // Reduced time penalty from 1.3 to 1.15 for less aggressive decay
  const numerator = 1.2 * metrics.replies + 1.5 * metrics.reposts + 1.0 * metrics.likes;
  const denominator = Math.pow(metrics.ageMin + 1, 1.15);
  return numerator / denominator;
}

/**
 * Get breakout class based on score
 */
function getBreakoutClass(score: number): string | null {
  if (score >= 3) return 'breakout-hot';    // Was 8
  if (score >= 1.5) return 'breakout-warm'; // Was 4
  if (score >= 0.5) return 'breakout-watch'; // Was 2
  return null;
}

/**
 * Clean up old tweet stats to prevent memory leak
 */
function cleanupOldStats(): void {
  const now = Date.now();
  const fourHoursMs = 4 * 60 * 60 * 1000;
  
  for (const [tweetId, stats] of tweetStats.entries()) {
    if (now - stats.firstSeen > fourHoursMs) {
      tweetStats.delete(tweetId);
    }
  }
}

/**
 * Apply heat map styling and keyword highlighting to a tweet article element
 */
function applyHeat(articleEl: HTMLElement): void {
  if (!settings.enabled) return;

  try {
    const targetEl = getTargetContainer(articleEl);
    
    // Get tweet ID for state tracking
    const tweetId = getTweetId(articleEl);
    if (!tweetId) return;
    
    // Extract metrics
    const metrics = extractMetrics(articleEl);
    if (!metrics) return;
    
    // Update tweet state
    const now = Date.now();
    if (!tweetStats.has(tweetId)) {
      tweetStats.set(tweetId, {
        firstSeen: now,
        lastMetrics: metrics,
        lastSeen: now
      });
    } else {
      const state = tweetStats.get(tweetId)!;
      state.lastMetrics = metrics;
      state.lastSeen = now;
    }
    
    // Remove all existing classes
    VIEW_THRESHOLDS.forEach(threshold => {
      targetEl.classList.remove(threshold.className);
    });
    targetEl.classList.remove('breakout-hot', 'breakout-warm', 'breakout-watch');
    
    // Apply indicator based on selected mode
    if (settings.indicatorMode === 'breakout') {
      // Breakout mode: Check guard rails first
      if (metrics.views > (settings.breakoutMaxViews || 100000) || 
          metrics.ageMin > (settings.breakoutMaxAge || 120)) {
        // Tweet is too old or too popular for breakout detection
        // Don't apply any indicator
      } else {
        // Calculate breakout score
        const score = getBreakoutScore(metrics);
        const breakoutClass = getBreakoutClass(score);
        
        if (breakoutClass) {
          targetEl.classList.add(breakoutClass);
        }
      }
    } else {
      // Views mode: Apply traditional view-based classes
      // Try to use extracted metrics first
      if (metrics.views > 0) {
        const className = getViewsClass(metrics.views);
        if (className !== 'views-0') {
          targetEl.classList.add(className);
        }
      } else {
        // Fallback to original view extraction method
        const viewsElement = articleEl.querySelector(
          'a[aria-label*=" views" i], [data-testid="viewCount"]'
        );
        
        if (viewsElement) {
          let rawCount = '';
          const label = viewsElement.getAttribute('aria-label') || '';
          rawCount = label.trim().split(' ')[0];
          
          const viewCount = parseViews(rawCount);
          
          if (viewCount !== null && viewCount > 0) {
            const className = getViewsClass(viewCount);
            if (className !== 'views-0') {
              targetEl.classList.add(className);
            }
          }
        }
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
    if (tweetTextElement && keywords.length > 0) {
      highlightKeywords(tweetTextElement as HTMLElement, keywords);
    }
    
    // Periodically clean up old stats
    if (Math.random() < 0.01) { // 1% chance on each call
      cleanupOldStats();
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
  
  // Remove breakout classes
  targetEl.classList.remove('breakout-hot', 'breakout-warm', 'breakout-watch');

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
        shouldUpdate = true;
      }
      
      if (shouldUpdate) {
        updateExtensionState();
      }
    }
  });
}

/**
 * Listen for messages from popup
 */
function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'MODE_CHANGED') {
      // Update settings immediately
      settings.indicatorMode = message.indicatorMode;
      
      // Force repaint of all tweets
      scanExisting();
      
      sendResponse({ success: true });
    } else if (message.type === 'SETTINGS_CHANGED' || message.type === 'settingsChanged') {
      // Update settings immediately
      settings = { ...settings, ...message.settings };
      
      // Force repaint of all tweets
      scanExisting();
      
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