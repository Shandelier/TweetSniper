interface ExplodingTopicsSettings {
  enabled: boolean;
  hideNonMatching: boolean;
  volumeMin: number | null;
  volumeMax: number | null;
  growthMin: number | null;
  growthMax: number | null;
  autoLoadMore: boolean;
  maxExtraPages: number;
}

interface ExtensionSettings {
  enabled?: boolean;
  explodingTopics?: Partial<ExplodingTopicsSettings>;
}

interface TopicMetrics {
  volume: number | null;
  growthPercent: number | null;
}

const SETTINGS_KEY = 'thm-settings';
const TOPIC_CARD_SELECTOR = 'a.tileLink, a[href^="/topic/"]';
const TILE_SELECTOR = '.tileStyle';
const UNBLUR_CLASS = 'ts-et-unblur';
const HIDDEN_FILTER_CLASS = 'ts-et-hidden-filter';

const EXPLODING_TOPICS_CSS = `
  .${UNBLUR_CLASS},
  .${UNBLUR_CLASS} *,
  .${UNBLUR_CLASS}.proTopicTileBlur,
  .${UNBLUR_CLASS} .proTopicTileBlur {
    filter: none !important;
    opacity: 1 !important;
  }

  .${HIDDEN_FILTER_CLASS} {
    display: none !important;
  }
`;

const defaultExplodingTopicsSettings: ExplodingTopicsSettings = {
  enabled: true,
  hideNonMatching: true,
  volumeMin: null,
  volumeMax: null,
  growthMin: null,
  growthMax: null,
  autoLoadMore: true,
  maxExtraPages: 3
};

let settings: ExplodingTopicsSettings = { ...defaultExplodingTopicsSettings };
let extensionEnabled = true;
let observer: MutationObserver | null = null;
let scheduledScan = false;
let loadedPageUrls = new Set<string>();
let isLoadingPages = false;
let styleElement: HTMLStyleElement | null = null;

function normalizeNumericSetting(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value >= 0 ? value : null;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  return Math.min(20, Math.max(1, rounded));
}

function normalizeSettings(raw: Partial<ExplodingTopicsSettings> | undefined): ExplodingTopicsSettings {
  if (!raw) {
    return { ...defaultExplodingTopicsSettings };
  }

  return {
    enabled: raw.enabled ?? defaultExplodingTopicsSettings.enabled,
    hideNonMatching: raw.hideNonMatching ?? defaultExplodingTopicsSettings.hideNonMatching,
    volumeMin: normalizeNumericSetting(raw.volumeMin),
    volumeMax: normalizeNumericSetting(raw.volumeMax),
    growthMin: normalizeNumericSetting(raw.growthMin),
    growthMax: normalizeNumericSetting(raw.growthMax),
    autoLoadMore: raw.autoLoadMore ?? defaultExplodingTopicsSettings.autoLoadMore,
    maxExtraPages: normalizePositiveInt(
      raw.maxExtraPages,
      defaultExplodingTopicsSettings.maxExtraPages
    )
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasTopicMetrics(card: HTMLElement): boolean {
  const text = normalizeText(card.textContent || '');
  return text.includes('volume') && text.includes('growth');
}

function getTiles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll(TILE_SELECTOR)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  );
}

function getTopicCards(root: ParentNode = document): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll(TOPIC_CARD_SELECTOR))
    .filter((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement)
    .filter(el => hasTopicMetrics(el));
}

function parseCompactNumber(rawText: string): number | null {
  const cleaned = rawText.replace(/[,\s]/g, '').trim();
  if (!cleaned) {
    return null;
  }

  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) {
    return null;
  }

  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) {
    return null;
  }

  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'k') {
    return base * 1_000;
  }
  if (suffix === 'm') {
    return base * 1_000_000;
  }
  if (suffix === 'b') {
    return base * 1_000_000_000;
  }
  return base;
}

function parseGrowthPercent(rawText: string): number | null {
  const cleaned = rawText.replace(/[+\s]/g, '').trim();
  if (!cleaned) {
    return null;
  }

  const percentMatch = cleaned.match(/^(\d+(?:\.\d+)?)%$/i);
  if (percentMatch) {
    const value = Number.parseFloat(percentMatch[1]);
    return Number.isFinite(value) ? value : null;
  }

  const xMatch = cleaned.match(/^(\d+(?:\.\d+)?)[x×]\+?$/i);
  if (xMatch) {
    const value = Number.parseFloat(xMatch[1]);
    if (!Number.isFinite(value)) {
      return null;
    }
    return value * 100;
  }

  return null;
}

function findMetricValueByLabel(card: HTMLElement, label: 'volume' | 'growth'): string | null {
  const nodes = Array.from(card.querySelectorAll<HTMLElement>('div, span, p, strong'));
  for (const node of nodes) {
    if (normalizeText(node.textContent || '') !== label) {
      continue;
    }
    const valueEl = node.previousElementSibling as HTMLElement | null;
    if (!valueEl) {
      continue;
    }
    const raw = (valueEl.textContent || '').trim();
    if (raw) {
      return raw;
    }
  }
  return null;
}

function extractMetrics(card: HTMLElement): TopicMetrics {
  const rawVolume = findMetricValueByLabel(card, 'volume');
  const rawGrowth = findMetricValueByLabel(card, 'growth');
  const directVolume = rawVolume ? parseCompactNumber(rawVolume) : null;
  const directGrowth = rawGrowth ? parseGrowthPercent(rawGrowth) : null;

  // Text fallback for DOM shape changes.
  const text = (card.textContent || '').replace(/\s+/g, ' ');
  const volumeMatch = text.match(/([0-9]+(?:\.[0-9]+)?\s*[kmb]?)\s*Volume/i);
  const growthMatch = text.match(/(\+?[0-9]+(?:\.[0-9]+)?\s*(?:%|[x×]\+?))\s*Growth/i);

  const fallbackVolume = volumeMatch ? parseCompactNumber(volumeMatch[1]) : null;
  const fallbackGrowth = growthMatch ? parseGrowthPercent(growthMatch[1]) : null;

  return {
    volume: directVolume ?? fallbackVolume,
    growthPercent: directGrowth ?? fallbackGrowth
  };
}

function isWithinRange(value: number | null, min: number | null, max: number | null): boolean {
  const rangeActive = min !== null || max !== null;
  if (value === null) {
    return !rangeActive;
  }

  if (min !== null && value < min) {
    return false;
  }
  if (max !== null && value > max) {
    return false;
  }

  return true;
}

function matchesFilters(metrics: TopicMetrics): boolean {
  return (
    isWithinRange(metrics.volume, settings.volumeMin, settings.volumeMax) &&
    isWithinRange(metrics.growthPercent, settings.growthMin, settings.growthMax)
  );
}

function getCardVisibilityTarget(card: HTMLAnchorElement): HTMLElement {
  return (card.closest('.tileStyle') as HTMLElement | null) ?? card;
}

function resetTileState(tile: HTMLElement): void {
  tile.classList.remove(UNBLUR_CLASS, HIDDEN_FILTER_CLASS);
  tile.style.removeProperty('display');
}

function applyTileCleanup(tile: HTMLElement): void {
  resetTileState(tile);

  if (!settings.enabled || !extensionEnabled) {
    return;
  }

  if (tile.classList.contains('proTopicTileBlur') || tile.querySelector('.proTopicTileBlur')) {
    tile.classList.add(UNBLUR_CLASS);
  }
}

function applyFiltersToCard(card: HTMLAnchorElement): void {
  const target = getCardVisibilityTarget(card);
  target.classList.remove(HIDDEN_FILTER_CLASS);

  if (!settings.enabled || !extensionEnabled) {
    return;
  }

  const metrics = extractMetrics(card);
  const isMatch = matchesFilters(metrics);
  if (settings.hideNonMatching && !isMatch) {
    target.classList.add(HIDDEN_FILTER_CLASS);
  }
}

function scanCards(): void {
  getTiles().forEach(tile => {
    applyTileCleanup(tile);
  });

  getTopicCards().forEach(card => {
    applyFiltersToCard(card);
  });
}

function scheduleScan(): void {
  if (scheduledScan) {
    return;
  }

  scheduledScan = true;
  window.requestAnimationFrame(() => {
    scheduledScan = false;
    scanCards();
  });
}

function toAbsolutePageUrl(url: string): string {
  return new URL(url, window.location.origin).toString();
}

function getCurrentPage(): number {
  const pageRaw = new URL(window.location.href).searchParams.get('page');
  const parsed = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function getPaginationUrls(): string[] {
  const currentPage = getCurrentPage();
  const pages = new Map<number, string>();

  document.querySelectorAll<HTMLAnchorElement>('a[href*="page="]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href) {
      return;
    }
    const absolute = toAbsolutePageUrl(href);
    const pageParam = new URL(absolute).searchParams.get('page');
    if (!pageParam) {
      return;
    }
    const pageNumber = Number.parseInt(pageParam, 10);
    if (!Number.isFinite(pageNumber) || pageNumber <= currentPage) {
      return;
    }
    pages.set(pageNumber, absolute);
  });

  return Array.from(pages.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, url]) => url);
}

function getTopicGridContainer(): HTMLElement | null {
  const cards = getTopicCards();
  const firstCard = cards[0];
  if (!firstCard) {
    return null;
  }
  const grid = firstCard.closest('.gridInstance') as HTMLElement | null;
  if (grid) {
    return grid;
  }
  return firstCard.parentElement;
}

function getCardPathname(card: HTMLAnchorElement): string | null {
  const href = card.getAttribute('href');
  if (!href) {
    return null;
  }
  return new URL(href, window.location.origin).pathname;
}

async function appendCardsFromPage(pageUrl: string): Promise<number> {
  const response = await fetch(pageUrl, { credentials: 'include' });
  if (!response.ok) {
    return 0;
  }

  const html = await response.text();
  const parsedDoc = new DOMParser().parseFromString(html, 'text/html');
  const sourceCards = getTopicCards(parsedDoc);
  const targetGrid = getTopicGridContainer();
  if (!targetGrid) {
    return 0;
  }

  const existingPathnames = new Set<string>();
  getTopicCards().forEach(card => {
    const pathname = getCardPathname(card);
    if (pathname) {
      existingPathnames.add(pathname);
    }
  });

  let appended = 0;
  sourceCards.forEach(card => {
    const pathname = getCardPathname(card);
    if (!pathname || existingPathnames.has(pathname)) {
      return;
    }

    const sourceWrapper = (card.closest('.tileStyle') as HTMLElement | null) ?? card;
    const imported = document.importNode(sourceWrapper, true) as HTMLElement;
    imported.dataset.tsEtAppended = 'true';
    targetGrid.appendChild(imported);

    existingPathnames.add(pathname);
    appended += 1;
  });

  return appended;
}

async function maybeLoadMorePages(): Promise<void> {
  if (!settings.enabled || !extensionEnabled || !settings.autoLoadMore) {
    return;
  }
  if (isLoadingPages) {
    return;
  }

  const urls = getPaginationUrls();
  if (urls.length === 0) {
    return;
  }

  isLoadingPages = true;
  try {
    let loadedCount = 0;
    for (const url of urls) {
      if (loadedCount >= settings.maxExtraPages) {
        break;
      }
      if (loadedPageUrls.has(url)) {
        continue;
      }
      loadedPageUrls.add(url);
      await appendCardsFromPage(url);
      loadedCount += 1;
    }

    scheduleScan();
  } catch (error) {
    console.debug('Tweet Sniper ExplodingTopics: Could not auto-load pages', error);
  } finally {
    isLoadingPages = false;
  }
}

function observeChanges(): void {
  if (observer) {
    return;
  }

  observer = new MutationObserver(() => {
    scheduleScan();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function injectStyles(): void {
  if (styleElement) {
    return;
  }
  styleElement = document.createElement('style');
  styleElement.id = 'thm-explodingtopics-styles';
  styleElement.textContent = EXPLODING_TOPICS_CSS;
  document.head.appendChild(styleElement);
}

function setupStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync' || !changes[SETTINGS_KEY]) {
      return;
    }

    const stored = changes[SETTINGS_KEY].newValue as ExtensionSettings | undefined;
    extensionEnabled = stored?.enabled ?? true;
    settings = normalizeSettings(stored?.explodingTopics);

    if (!settings.autoLoadMore) {
      loadedPageUrls = new Set<string>();
    }

    void maybeLoadMorePages();
    scheduleScan();
  });
}

function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener(message => {
    if (
      message.action === 'forceRefresh' ||
      message.type === 'SETTINGS_CHANGED' ||
      message.type === 'settingsChanged' ||
      message.type === 'FILTER_CHANGED'
    ) {
      void loadSettings().then(async () => {
        await maybeLoadMorePages();
        scheduleScan();
      });
    }
  });
}

async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get([SETTINGS_KEY]);
    const stored = result[SETTINGS_KEY] as ExtensionSettings | undefined;
    extensionEnabled = stored?.enabled ?? true;
    settings = normalizeSettings(stored?.explodingTopics);
  } catch (error) {
    console.debug('Tweet Sniper ExplodingTopics: Error loading settings', error);
  }
}

function setupCleanup(): void {
  window.addEventListener('beforeunload', () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });
}

async function initExplodingTopics(): Promise<void> {
  injectStyles();
  await loadSettings();
  scanCards();
  await maybeLoadMorePages();
  observeChanges();
  setupStorageListener();
  setupMessageListener();
  setupCleanup();
}

if (window.location.hostname.endsWith('explodingtopics.com')) {
  initExplodingTopics().catch(error => {
    console.error('Tweet Sniper ExplodingTopics: Initialization failed', error);
  });
}
