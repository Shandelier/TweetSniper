import { p as parseViews, h as highlightKeywords, r as removeKeywordHighlights } from "./utils.js";
const VIEW_THRESHOLDS = [
  { min: 0, max: 1e3, className: "views-0" },
  { min: 1001, max: 1e4, className: "views-1" },
  { min: 10001, max: 5e4, className: "views-2" },
  { min: 50001, max: 25e4, className: "views-3" }
];
const HEAT_MAP_CSS = `
  .views-1 { border-right: 5px solid #B4C6FF !important; }
  .views-2 { border-right: 5px solid #BDF4C4 !important; }
  .views-3 { border-right: 5px solid #FFC2C2 !important; }
`;
let settings = { enabled: true };
let keywords = [];
let observer = null;
let styleElement = null;
function getViewsClass(viewCount) {
  for (const threshold of VIEW_THRESHOLDS) {
    if (viewCount >= threshold.min && viewCount <= threshold.max) {
      return threshold.className;
    }
  }
  return VIEW_THRESHOLDS[VIEW_THRESHOLDS.length - 1].className;
}
function isTweetFresh(timeElement) {
  const datetime = timeElement.getAttribute("datetime");
  if (!datetime) return false;
  const tweetTime = new Date(datetime);
  const now = /* @__PURE__ */ new Date();
  const diffMinutes = (now.getTime() - tweetTime.getTime()) / (1e3 * 60);
  return diffMinutes <= 30;
}
function updateFireEmoji(timeElement, shouldAdd) {
  const textContent = timeElement.textContent || "";
  const hasEmoji = textContent.startsWith("🔥 ");
  if (shouldAdd && !hasEmoji) {
    timeElement.textContent = "🔥 " + textContent;
  } else if (!shouldAdd && hasEmoji) {
    timeElement.textContent = textContent.replace("🔥 ", "");
  }
}
function getTargetContainer(articleEl) {
  return articleEl.parentElement || articleEl;
}
function applyHeat(articleEl) {
  if (!settings.enabled) return;
  try {
    const targetEl = getTargetContainer(articleEl);
    const viewsElement = articleEl.querySelector(
      'a[aria-label*=" views" i], [data-testid="viewCount"]'
    );
    if (viewsElement) {
      let rawCount = "";
      const label = viewsElement.getAttribute("aria-label") || "";
      rawCount = label.trim().split(" ")[0];
      const viewCount = parseViews(rawCount);
      if (viewCount === null) {
        return;
      }
      VIEW_THRESHOLDS.forEach((threshold) => {
        targetEl.classList.remove(threshold.className);
      });
      const className = getViewsClass(viewCount);
      if (className !== "views-0") {
        targetEl.classList.add(className);
      }
    }
    const timeElement = articleEl.querySelector("time");
    if (timeElement) {
      const isFresh = isTweetFresh(timeElement);
      updateFireEmoji(timeElement, isFresh);
    }
    const tweetTextElement = articleEl.querySelector('[data-testid="tweetText"]');
    if (tweetTextElement && keywords.length > 0) {
      highlightKeywords(tweetTextElement, keywords);
    }
  } catch (error) {
  }
}
function removeHeat(articleEl) {
  const targetEl = getTargetContainer(articleEl);
  VIEW_THRESHOLDS.forEach((threshold) => {
    targetEl.classList.remove(threshold.className);
  });
  const timeElement = articleEl.querySelector("time");
  if (timeElement) {
    updateFireEmoji(timeElement, false);
  }
  const tweetTextElement = articleEl.querySelector('[data-testid="tweetText"]');
  if (tweetTextElement) {
    removeKeywordHighlights(tweetTextElement);
  }
}
function scanExisting() {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  tweets.forEach((tweet) => {
    if (settings.enabled) {
      applyHeat(tweet);
    } else {
      removeHeat(tweet);
    }
  });
}
function observeNew() {
  if (observer) return;
  const targetNode = document.querySelector("main");
  if (!targetNode) return;
  observer = new MutationObserver((mutations) => {
    const processChanges = () => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const element = node;
          if (element.matches('article[data-testid="tweet"]')) {
            applyHeat(element);
          }
          element.querySelectorAll('article[data-testid="tweet"]').forEach((tweet) => {
            applyHeat(tweet);
          });
        });
        if (mutation.type === "attributes") {
          const parentTweet = mutation.target.closest(
            'article[data-testid="tweet"]'
          );
          if (parentTweet) {
            applyHeat(parentTweet);
          }
        }
      });
    };
    if ("requestIdleCallback" in window) {
      requestIdleCallback(processChanges);
    } else {
      setTimeout(processChanges, 0);
    }
  });
  observer.observe(targetNode, {
    childList: true,
    subtree: true,
    attributes: true
  });
}
function injectStyles() {
  if (styleElement) return;
  styleElement = document.createElement("style");
  styleElement.id = "thm-styles";
  styleElement.textContent = HEAT_MAP_CSS;
  document.head.appendChild(styleElement);
}
function removeStyles() {
  if (styleElement) {
    styleElement.remove();
    styleElement = null;
  }
}
function updateExtensionState() {
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
    scanExisting();
  }
}
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(["thm-settings"]);
    if (result["thm-settings"]) {
      settings = { ...settings, ...result["thm-settings"] };
    }
  } catch (error) {
    console.debug("Tweet Heat Map: Error loading settings", error);
  }
}
async function loadKeywords() {
  try {
    const result = await chrome.storage.sync.get(["thm-keywords"]);
    keywords = result["thm-keywords"] || [];
  } catch (error) {
    console.debug("Tweet Heat Map: Error loading keywords", error);
  }
}
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync") {
      let shouldUpdate = false;
      if (changes["thm-settings"]) {
        const newSettings = changes["thm-settings"].newValue;
        if (newSettings) {
          settings = { ...settings, ...newSettings };
          shouldUpdate = true;
        }
      }
      if (changes["thm-keywords"]) {
        const newKeywords = changes["thm-keywords"].newValue;
        keywords = newKeywords || [];
        shouldUpdate = true;
      }
      if (shouldUpdate) {
        updateExtensionState();
      }
    }
  });
}
function setupCleanup() {
  window.addEventListener("beforeunload", () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });
}
async function init() {
  await loadSettings();
  await loadKeywords();
  setupStorageListener();
  setupCleanup();
  const runLogic = () => {
    updateExtensionState();
  };
  const mainEl = document.querySelector("main");
  if (mainEl) {
    runLogic();
  } else {
    const initialObserver = new MutationObserver((mutations, obs) => {
      if (document.querySelector("main")) {
        obs.disconnect();
        runLogic();
      }
    });
    initialObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}
init().catch((error) => {
  console.error("Tweet Heat Map: Initialization failed", error);
});
