// Tweet Heat Map - Content Script
// Color-codes tweets by view-count and flags fresh ones with 🔥

import { parseViews, parseCount, Keyword, highlightKeywords, removeKeywordHighlights } from './utils.js';

interface Settings {
  enabled: boolean;
  indicatorMode: 'views' | 'breakout';
  breakoutMaxViews?: number;
  breakoutMaxAge?: number;
  showOnlyBreakout?: boolean;
  newPostsPillPosition?: 'top' | 'bottom' | 'hidden';
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

const STATUS_PILL_CSS = `
  div[role="status"].ts-new-posts-pill[data-ts-new-posts="true"] {
    display: flex !important;
    justify-content: center !important;
    pointer-events: none !important;
    position: fixed !important;
    left: 50% !important;
    top: auto !important;
    bottom: auto !important;
    transform: translateX(-50%) !important;
    width: auto !important;
    z-index: 2147483647 !important;
  }

  div[role="status"].ts-new-posts-pill[data-ts-new-posts="true"][data-ts-new-posts-position="top"] {
    top: 32px !important;
    bottom: auto !important;
  }

  div[role="status"].ts-new-posts-pill[data-ts-new-posts="true"][data-ts-new-posts-position="bottom"] {
    bottom: 32px !important;
    top: auto !important;
  }

  div[role="status"].ts-new-posts-pill[data-ts-new-posts="true"] > button.ts-new-posts-pill-button {
    pointer-events: auto !important;
  }
`;

let settings: Settings = {
  enabled: true,
  indicatorMode: 'views',
  breakoutMaxViews: 100000,
  breakoutMaxAge: 120,
  showOnlyBreakout: false,
  newPostsPillPosition: 'bottom'
};
let keywords: Keyword[] = [];
let observer: MutationObserver | null = null;
let styleElement: HTMLStyleElement | null = null;
function cleanupNewPostButtonStyles(button: HTMLButtonElement): void {
  button.style.pointerEvents = '';
  button.style.transform = '';
}

function cleanupStatusPill(statusEl: HTMLElement, button?: HTMLButtonElement | null): void {
  statusEl.classList.remove('ts-new-posts-pill');
  delete statusEl.dataset.tsNewPosts;
  delete statusEl.dataset.tsNewPostsPosition;
  statusEl.style.pointerEvents = '';
  statusEl.style.display = '';

  const targetButton =
    button ??
    statusEl.querySelector<HTMLButtonElement>('button.ts-new-posts-pill-button') ??
    statusEl.querySelector<HTMLButtonElement>('button');

  if (targetButton) {
    targetButton.classList.remove('ts-new-posts-pill-button');
    cleanupNewPostButtonStyles(targetButton);
  }
}

function markStatusPills(root: ParentNode = document): void {
  const statusElements: HTMLElement[] = [];
  if (root instanceof Element && root.matches('div[role="status"]')) {
    statusElements.push(root as HTMLElement);
  }
  root.querySelectorAll<HTMLElement>('div[role="status"]').forEach(status => {
    statusElements.push(status);
  });

  statusElements.forEach(statusEl => {
    const pillLabel = statusEl.querySelector('[data-testid="pillLabel"]');
    const button = statusEl.querySelector<HTMLButtonElement>('button');

    if (!settings.enabled) {
      cleanupStatusPill(statusEl, button);
      return;
    }

    if (!pillLabel || !button) {
      cleanupStatusPill(statusEl, button);
      return;
    }

    const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() ?? '';
    const isNewPosts = ariaLabel.includes('new posts');
    const desiredPosition = settings.newPostsPillPosition ?? 'bottom';

    if (isNewPosts) {
      if (desiredPosition === 'hidden') {
        cleanupStatusPill(statusEl, button);
        statusEl.style.display = 'none';
        return;
      }

      statusEl.style.display = '';
      statusEl.classList.add('ts-new-posts-pill');
      button.classList.add('ts-new-posts-pill-button');
      statusEl.dataset.tsNewPosts = 'true';
      statusEl.dataset.tsNewPostsPosition = desiredPosition;
      statusEl.style.pointerEvents = 'none';
      button.style.pointerEvents = 'auto';
      button.style.transform = '';
    } else {
      cleanupStatusPill(statusEl, button);
      statusEl.style.display = '';
    }
  });
}

// Follower cache state
type FollowerCacheEntry = { count: number; updated: number };
const FOLLOWER_CACHE_KEY = 'ts-follower-cache';
let followerCache: Record<string, FollowerCacheEntry> = {};
let lastProfileCacheUpdate: { handle: string; ts: number } | null = null;

// Follower badge thresholds and styling
const FOLLOWER_THRESHOLDS = [
  { max: 1000, className: 'follower-0' },
  { max: 5000, className: 'follower-1' },
  { max: 50000, className: 'follower-2' },
  { max: 500000, className: 'follower-3' },
  { max: 1000000, className: 'follower-4' },
  { max: Infinity, className: 'follower-5' },
];

const FOLLOWER_BADGE_CSS = `
  .ts-follower-badge { font-size: 10px; line-height: 1; margin-top: 2px; }
  .follower-0 { color: #657786; }
  .follower-1 { color: #1DA1F2; }
  .follower-2 { color: #17BF63; }
  .follower-3 { color: #F39C12; }
  .follower-4 { color: #E0245E; }
  .follower-5 { color: #8E44AD; }
`;

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

// ---- Follower badge helpers ----

function formatFollowerCount(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return count.toString();
}

function getFollowerClass(count: number): string {
  for (const threshold of FOLLOWER_THRESHOLDS) {
    if (count <= threshold.max) return threshold.className;
  }
  return FOLLOWER_THRESHOLDS[FOLLOWER_THRESHOLDS.length - 1].className;
}

function addFollowerBadge(avatar: HTMLElement, count: number): void {
  avatar.style.display = 'flex';
  avatar.style.flexDirection = 'column';
  avatar.style.alignItems = 'center';

  let badge = avatar.querySelector('.ts-follower-badge') as HTMLSpanElement | null;
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'ts-follower-badge';
    avatar.appendChild(badge);
  }

  badge.textContent = formatFollowerCount(count);
  badge.className = `ts-follower-badge ${getFollowerClass(count)}`;
}

// ---- Follower cache helpers ----
async function loadFollowerCache(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([FOLLOWER_CACHE_KEY]);
    followerCache = result[FOLLOWER_CACHE_KEY] || {};
  } catch {
    followerCache = {};
  }
}

async function saveFollowerCount(handle: string, count: number): Promise<void> {
  if (!handle || !Number.isFinite(count)) return;
  const key = handle.toLowerCase();
  followerCache[key] = { count, updated: Date.now() };
  try {
    await chrome.storage.local.set({ [FOLLOWER_CACHE_KEY]: followerCache });
  } catch {
    // Ignore storage errors
  }
}

function getCachedFollowerCount(handle: string): number | null {
  if (!handle) return null;
  const key = handle.toLowerCase();
  const entry = followerCache[key];
  return entry ? entry.count : null;
}

function getUsernameFromArticle(articleEl: HTMLElement): string | null {
  // Use /<user>/status/<id> link
  const link = articleEl.querySelector('a[href*="/status/"]');
  const href = link?.getAttribute('href') || '';
  const match = href.match(/\/([^\/]+)\/status\/\d+/);
  return match ? match[1] : null;
}

function renderBadgeFromCacheForArticle(articleEl: HTMLElement): void {
  const handle = getUsernameFromArticle(articleEl);
  if (!handle) return;
  const count = getCachedFollowerCount(handle);
  if (count == null) return;
  const avatar = articleEl.querySelector('div[data-testid="Tweet-User-Avatar"]') as HTMLElement | null;
  if (!avatar) return;
  addFollowerBadge(avatar, count);
}

function renderBadgesFromCacheInContainer(root: ParentNode = document): void {
  root.querySelectorAll('article[data-testid="tweet"]').forEach(el => {
    renderBadgeFromCacheForArticle(el as HTMLElement);
  });
}

function extractHandleFromHoverCard(popover: Element): string | null {
  const text = popover.textContent || '';
  const atMatch = text.match(/@([A-Za-z0-9_]{1,15})/);
  return atMatch ? atMatch[1] : null;
}

// ---- User cell helpers (followers/following/verified_followers tabs) ----
function isReservedTopPath(segment: string): boolean {
  const reserved = new Set([
    'home','explore','notifications','messages','i','settings','compose','search','marketplace','tos','privacy','login','signup','hashtag','topics'
  ]);
  return reserved.has(segment.toLowerCase());
}

function getHandleFromUserCell(cellEl: HTMLElement): string | null {
  // Try profile links within the cell
  const anchors = Array.from(cellEl.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    if (href.includes('/status/')) continue;
    const m = href.match(/^\/([A-Za-z0-9_]{1,15})(?:$|[/?#])/);
    if (m && !isReservedTopPath(m[1])) return m[1];
  }
  // Fallback to text '@handle'
  const text = cellEl.textContent || '';
  const tm = text.match(/@([A-Za-z0-9_]{1,15})/);
  return tm ? tm[1] : null;
}

function findAvatarContainer(root: Element): HTMLElement | null {
  const direct = (root.closest('div[data-testid="Tweet-User-Avatar"], div[data-testid="UserAvatar-Container"], div[data-testid="UserAvatar"]') as HTMLElement | null);
  if (direct) return direct;
  const nested = root.querySelector('div[data-testid="Tweet-User-Avatar"], div[data-testid="UserAvatar-Container"], div[data-testid="UserAvatar"]') as HTMLElement | null;
  return nested;
}

function renderBadgeFromCacheForUserCell(cellEl: HTMLElement): void {
  const handle = getHandleFromUserCell(cellEl);
  if (!handle) return;
  const count = getCachedFollowerCount(handle);
  if (count == null) return;
  const avatar = findAvatarContainer(cellEl);
  if (!avatar) return;
  addFollowerBadge(avatar, count);
}

function pollFollowerCount(avatar: HTMLElement, attempt = 0): void {
  const popover = document.querySelector('[data-testid="HoverCard"]');
  if (popover) {
    const text = popover.textContent || '';
    const match = text.match(/([\d,.]+\s*[KkMmBb]?)\s*Followers/i);
    if (match) {
      const count = parseCount(match[1]);
      if (typeof count === 'number') {
        // Try to determine the handle to cache the value
        let handle: string | null = null;
        const article = avatar.closest('article[data-testid="tweet"]') as HTMLElement | null;
        if (article) handle = getUsernameFromArticle(article);
        // Check a user cell context as well
        if (!handle) {
          const userCell = avatar.closest('div[data-testid="UserCell"]') as HTMLElement | null;
          if (userCell) {
            handle = getHandleFromUserCell(userCell);
          }
        }
        if (!handle) handle = extractHandleFromHoverCard(popover);
        if (handle) {
          void saveFollowerCount(handle, count);
        }
        addFollowerBadge(avatar, count);
        return;
      }
    }
  }

  if (attempt < 10) {
    setTimeout(() => pollFollowerCount(avatar, attempt + 1), 200);
  }
}

function onAvatarHover(event: MouseEvent): void {
  const avatar = (event.target as HTMLElement).closest(
    'div[data-testid="Tweet-User-Avatar"], div[data-testid="UserAvatar-Container"], div[data-testid="UserAvatar"]'
  );
  if (!avatar || (avatar as HTMLElement).querySelector('.ts-follower-badge')) return;
  setTimeout(() => pollFollowerCount(avatar as HTMLElement), 300);
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
 * Check if a tweet is a sponsored ad
 */
function isSponsoredAd(articleEl: HTMLElement): boolean {
  // Look for span elements containing "Ad" text
  const spans = articleEl.querySelectorAll('span');
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const text = span.textContent?.trim();
    if (text === 'Ad' || text === 'Sponsored' || text === 'Promoted') {
      return true;
    }
  }
  
  // Additional check for "From [domain]" links which often indicate ads
  const links = articleEl.querySelectorAll('a[href]');
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const text = link.textContent?.trim();
    if (text && text.startsWith('From ') && text.includes('.com')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a tweet has any indicator (breakout or views based on current mode)
 */
function hasAnyIndicator(articleEl: HTMLElement): boolean {
  const targetEl = getTargetContainer(articleEl);
  
  if (settings.indicatorMode === 'breakout') {
    // In breakout mode, check for breakout classes
    return targetEl.classList.contains('breakout-hot') || 
           targetEl.classList.contains('breakout-warm') || 
           targetEl.classList.contains('breakout-watch');
  } else {
    // In views mode, check for view classes (excluding views-0 which is the default)
    return targetEl.classList.contains('views-1') ||
           targetEl.classList.contains('views-2') ||
           targetEl.classList.contains('views-3') ||
           targetEl.classList.contains('views-4');
  }
}

/**
 * Apply or remove breakout filter to tweets
 */
function applyBreakoutFilter(): void {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  
  tweets.forEach(tweet => {
    const tweetEl = tweet as HTMLElement;
    const targetEl = getTargetContainer(tweetEl);
    
    if (settings.showOnlyBreakout) {
      // Hide tweets that don't have any indicators OR are sponsored ads
      if (!hasAnyIndicator(tweetEl) || isSponsoredAd(tweetEl)) {
        targetEl.style.display = 'none';
      } else {
        targetEl.style.display = '';
      }
    } else {
      // Show all tweets (remove filter)
      targetEl.style.display = '';
    }
  });
}

/**
 * Apply heat map styling and keyword highlighting to a tweet article element
 */
function applyHeat(articleEl: HTMLElement): void {
  if (!settings.enabled) return;

  try {
    const targetEl = getTargetContainer(articleEl);
    // Render follower badge from cache for this tweet's author (independent of heatmap)
    renderBadgeFromCacheForArticle(articleEl);
    
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
    if (tweetTextElement) {
      // Always remove existing highlights first to ensure clean state
      removeKeywordHighlights(tweetTextElement as HTMLElement);
      
      // Then apply current keywords if any exist
      if (keywords.length > 0) {
        highlightKeywords(tweetTextElement as HTMLElement, keywords);
      }
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
  
  // Reset display style (remove any filter hiding)
  targetEl.style.display = '';
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
  
  // Apply breakout filter after processing all tweets (only when enabled)
  if (settings.enabled && settings.showOnlyBreakout) {
    applyBreakoutFilter();
  } else if (!settings.enabled || !settings.showOnlyBreakout) {
    // Ensure all tweets are visible when filter is disabled
    tweets.forEach(tweet => {
      const targetEl = getTargetContainer(tweet as HTMLElement);
      targetEl.style.display = '';
    });
  }

  // Render follower badges for any visible tweets using cached values
  renderBadgesFromCacheInContainer(document);
  // Render follower badges for user lists (followers/verified followers/etc.)
  document.querySelectorAll('div[data-testid="UserCell"]').forEach(cell => {
    renderBadgeFromCacheForUserCell(cell as HTMLElement);
  });

  markStatusPills(document);
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
      let hasNewTweets = false;
      
      mutations.forEach(mutation => {
        // Case 1: New nodes were added to the DOM
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const element = node as Element;
          if (element.matches('article[data-testid="tweet"]')) {
            applyHeat(element as HTMLElement);
            hasNewTweets = true;
          }
          if (element.matches('div[data-testid="UserCell"]')) {
            renderBadgeFromCacheForUserCell(element as HTMLElement);
          }
          element
            .querySelectorAll('article[data-testid="tweet"]')
            .forEach(tweet => {
              applyHeat(tweet as HTMLElement);
              hasNewTweets = true;
            });
          element
            .querySelectorAll('div[data-testid="UserCell"]')
            .forEach(cell => {
              renderBadgeFromCacheForUserCell(cell as HTMLElement);
            });

          markStatusPills(element);
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
          const parentCell = (mutation.target as Element).closest(
            'div[data-testid="UserCell"]'
          );
          if (parentCell) {
            renderBadgeFromCacheForUserCell(parentCell as HTMLElement);
          }
        }
      });
      
      // Apply filter after processing new tweets if needed
      if (hasNewTweets && settings.enabled && settings.showOnlyBreakout) {
        applyBreakoutFilter();
      }

      markStatusPills(document);

      // Attempt to update follower cache if we're on a profile page
      maybeUpdateProfileCache();
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
  styleElement.textContent = HEAT_MAP_CSS + FOLLOWER_BADGE_CSS + STATUS_PILL_CSS;
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

    // Listen for follower cache updates in local storage
    if (namespace === 'local') {
      if (changes[FOLLOWER_CACHE_KEY]) {
        const newCache = changes[FOLLOWER_CACHE_KEY].newValue as Record<string, FollowerCacheEntry> | undefined;
        if (newCache) {
          followerCache = newCache;
          // Re-render badges using updated cache
          renderBadgesFromCacheInContainer(document);
          document.querySelectorAll('div[data-testid="UserCell"]').forEach(cell => {
            renderBadgeFromCacheForUserCell(cell as HTMLElement);
          });
        }
      }
    }
  });
}

/**
 * Listen for messages from popup to handle various actions
 */
function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'forceRefresh') {
      console.debug('Tweet Heat Map: Received force refresh request from popup');
      
      // Force complete refresh instead of just updateExtensionState
      forceCompleteRefresh();
      
      // Send acknowledgment
      sendResponse({ success: true });
    } else if (message.type === 'MODE_CHANGED') {
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
    } else if (message.type === 'FILTER_CHANGED') {
      // Update filter setting immediately
      settings.showOnlyBreakout = message.showOnlyBreakout;
      
      // Apply filter to current tweets
      applyBreakoutFilter();
      
      sendResponse({ success: true });
    }
    
    return true; // Keep message channel open for async response
  });
}

function setupFollowerHover(): void {
  document.addEventListener('mouseenter', onAvatarHover, true);
}

// ---- Profile page detection and cache update ----
function getProfileHandleFromURL(): string | null {
  const path = location.pathname.split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const candidate = parts[0];
  const reserved = new Set([
    'home','explore','notifications','messages','i','settings','compose','search','marketplace','tos','privacy','login','signup','hashtag','topics'
  ]);
  if (reserved.has(candidate.toLowerCase())) return null;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(candidate)) return null;
  return candidate;
}

function parseProfileFollowerCount(handle: string): number | null {
  // Try the /<handle>/followers link first
  const followersLink = document.querySelector(`a[href$="/${handle}/followers"]`);
  if (followersLink) {
    const aria = followersLink.getAttribute('aria-label') || '';
    const ariaMatch = aria.match(/([\d,.]+\s*[KkMmBb]?)\s*Followers/i);
    if (ariaMatch) return parseCount(ariaMatch[1]);
    const text = followersLink.textContent || '';
    const textMatch = text.match(/([\d,.]+\s*[KkMmBb]?)\s*Followers/i);
    if (textMatch) return parseCount(textMatch[1]);
  }
  // Fallback: any element text with Followers
  const all = Array.from(document.querySelectorAll('a, span, div'));
  for (const el of all) {
    const t = (el.textContent || '').trim();
    if (/Followers/i.test(t)) {
      const m = t.match(/([\d,.]+\s*[KkMmBb]?)\s*Followers/i);
      if (m) {
        const val = parseCount(m[1]);
        if (val != null) return val;
      }
    }
  }
  return null;
}

function maybeUpdateProfileCache(): void {
  const handle = getProfileHandleFromURL();
  if (!handle) return;
  const now = Date.now();
  if (lastProfileCacheUpdate && lastProfileCacheUpdate.handle === handle && now - lastProfileCacheUpdate.ts < 15000) {
    return; // avoid excessive parsing within 15s
  }
  const count = parseProfileFollowerCount(handle);
  if (typeof count === 'number') {
    lastProfileCacheUpdate = { handle, ts: now };
    void saveFollowerCount(handle, count);
    renderBadgesFromCacheInContainer(document);
  }
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
  await loadFollowerCache();
  await loadSettings();
  await loadKeywords();
  setupStorageListener();
  setupMessageListener();
  setupCleanup();
  setupFollowerHover();

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
