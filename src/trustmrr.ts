interface TrustMrrSettings {
  enabled: boolean;
  hideNonMatching: boolean;
  colorCoding: boolean;
  revenueMin: number | null;
  revenueMax: number | null;
  mrrMin: number | null;
  mrrMax: number | null;
  totalMin: number | null;
  totalMax: number | null;
}

interface ExtensionSettings {
  enabled?: boolean;
  trustMrr?: Partial<TrustMrrSettings>;
}

interface StartupMetrics {
  revenue: number | null;
  mrr: number | null;
  total: number | null;
  mrrValueElement: HTMLElement | null;
}

const SETTINGS_KEY = 'thm-settings';
const CARD_SELECTOR = 'a[href^="/startup/"], a[href*="/startup/"]';
const MRR_CLASS_1K = 'ts-trustmrr-mrr-1k';
const MRR_CLASS_10K = 'ts-trustmrr-mrr-10k';
const MRR_CLASS_100K = 'ts-trustmrr-mrr-100k';

const TRUST_MRR_CSS = `
  .${MRR_CLASS_1K},
  .${MRR_CLASS_10K},
  .${MRR_CLASS_100K} {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 6px;
    transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  }

  .${MRR_CLASS_1K} {
    background-color: rgba(234, 179, 8, 0.18);
    color: #7c2d12;
  }

  .${MRR_CLASS_10K} {
    background-color: rgba(249, 115, 22, 0.24);
    color: #7f1d1d;
  }

  .${MRR_CLASS_100K} {
    background-color: rgba(220, 38, 38, 0.32);
    color: #7f1d1d;
    box-shadow: inset 0 0 0 1px rgba(127, 29, 29, 0.15);
  }
`;

const defaultTrustMrrSettings: TrustMrrSettings = {
  enabled: true,
  hideNonMatching: true,
  colorCoding: true,
  revenueMin: null,
  revenueMax: null,
  mrrMin: null,
  mrrMax: null,
  totalMin: null,
  totalMax: null
};

let settings: TrustMrrSettings = { ...defaultTrustMrrSettings };
let extensionEnabled = true;
let observer: MutationObserver | null = null;
let styleElement: HTMLStyleElement | null = null;
let scheduledScan = false;

function normalizeNumericSetting(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value >= 0 ? value : null;
}

function normalizeSettings(raw: Partial<TrustMrrSettings> | undefined): TrustMrrSettings {
  if (!raw) {
    return { ...defaultTrustMrrSettings };
  }

  return {
    enabled: raw.enabled ?? defaultTrustMrrSettings.enabled,
    hideNonMatching: raw.hideNonMatching ?? defaultTrustMrrSettings.hideNonMatching,
    colorCoding: raw.colorCoding ?? defaultTrustMrrSettings.colorCoding,
    revenueMin: normalizeNumericSetting(raw.revenueMin),
    revenueMax: normalizeNumericSetting(raw.revenueMax),
    mrrMin: normalizeNumericSetting(raw.mrrMin),
    mrrMax: normalizeNumericSetting(raw.mrrMax),
    totalMin: normalizeNumericSetting(raw.totalMin),
    totalMax: normalizeNumericSetting(raw.totalMax)
  };
}

function parseCompactCurrency(rawText: string): number | null {
  const cleaned = rawText.replace(/[$€£,\s]/g, '').trim();
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

function textEqualsNormalized(text: string, expected: string): boolean {
  return text.trim().toLowerCase() === expected;
}

function extractMetrics(card: HTMLElement): StartupMetrics {
  const metrics: StartupMetrics = {
    revenue: null,
    mrr: null,
    total: null,
    mrrValueElement: null
  };

  const labels = card.querySelectorAll('p');
  labels.forEach(labelEl => {
    const labelText = (labelEl.textContent || '').trim().toLowerCase();
    const valueEl = labelEl.nextElementSibling;
    if (!(valueEl instanceof HTMLElement)) {
      return;
    }
    const numericValue = parseCompactCurrency(valueEl.textContent || '');
    if (numericValue === null) {
      return;
    }

    if (labelText.startsWith('revenue')) {
      metrics.revenue = numericValue;
      return;
    }
    if (textEqualsNormalized(labelText, 'mrr')) {
      metrics.mrr = numericValue;
      metrics.mrrValueElement = valueEl;
      return;
    }
    if (textEqualsNormalized(labelText, 'total')) {
      metrics.total = numericValue;
    }
  });

  return metrics;
}

function hasMetricData(card: HTMLElement): boolean {
  const text = (card.textContent || '').toLowerCase();
  return text.includes('revenue') && text.includes('mrr') && text.includes('total');
}

function getStartupCards(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll(CARD_SELECTOR))
    .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement)
    .filter(link => hasMetricData(link));
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

function matchesFilters(metrics: StartupMetrics): boolean {
  return (
    isWithinRange(metrics.revenue, settings.revenueMin, settings.revenueMax) &&
    isWithinRange(metrics.mrr, settings.mrrMin, settings.mrrMax) &&
    isWithinRange(metrics.total, settings.totalMin, settings.totalMax)
  );
}

function resetCardState(card: HTMLAnchorElement): void {
  card
    .querySelectorAll(`.${MRR_CLASS_1K}, .${MRR_CLASS_10K}, .${MRR_CLASS_100K}`)
    .forEach(el => {
      el.classList.remove(MRR_CLASS_1K, MRR_CLASS_10K, MRR_CLASS_100K);
    });
  card.style.display = '';
}

function applyColorCoding(mrrValueElement: HTMLElement | null, mrr: number | null): void {
  if (!settings.colorCoding || !mrrValueElement || mrr === null) {
    return;
  }

  // No highlight below 1k MRR by request.
  if (mrr < 1_000) {
    return;
  }

  if (mrr < 10_000) {
    mrrValueElement.classList.add(MRR_CLASS_1K);
    return;
  }

  if (mrr < 100_000) {
    mrrValueElement.classList.add(MRR_CLASS_10K);
    return;
  }

  mrrValueElement.classList.add(MRR_CLASS_100K);
}

function applyToCard(card: HTMLAnchorElement): void {
  resetCardState(card);

  if (!settings.enabled) {
    return;
  }
  if (!extensionEnabled) {
    return;
  }

  const metrics = extractMetrics(card);
  const isMatch = matchesFilters(metrics);

  if (settings.hideNonMatching && !isMatch) {
    card.style.display = 'none';
    return;
  }

  applyColorCoding(metrics.mrrValueElement, metrics.mrr);
}

function scanCards(): void {
  getStartupCards().forEach(card => {
    applyToCard(card);
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

function injectStyles(): void {
  if (styleElement) {
    return;
  }

  styleElement = document.createElement('style');
  styleElement.id = 'thm-trustmrr-styles';
  styleElement.textContent = TRUST_MRR_CSS;
  document.head.appendChild(styleElement);
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

function setupStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync' || !changes[SETTINGS_KEY]) {
      return;
    }

    const stored = changes[SETTINGS_KEY].newValue as ExtensionSettings | undefined;
    extensionEnabled = stored?.enabled ?? true;
    settings = normalizeSettings(stored?.trustMrr);
    scheduleScan();
  });
}

function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener(message => {
    if (message.action === 'forceRefresh') {
      void loadSettings().then(() => {
        scheduleScan();
      });
      return;
    }

    if (
      message.type === 'SETTINGS_CHANGED' ||
      message.type === 'settingsChanged' ||
      message.type === 'FILTER_CHANGED'
    ) {
      void loadSettings().then(() => {
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
    settings = normalizeSettings(stored?.trustMrr);
  } catch (error) {
    console.debug('Tweet Sniper TrustMRR: Error loading settings', error);
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

async function initTrustMrr(): Promise<void> {
  injectStyles();
  await loadSettings();
  scanCards();
  observeChanges();
  setupStorageListener();
  setupMessageListener();
  setupCleanup();
}

if (window.location.hostname.endsWith('trustmrr.com')) {
  initTrustMrr().catch(error => {
    console.error('Tweet Sniper TrustMRR: Initialization failed', error);
  });
}
