function parseViews(text) {
  if (!text) return null;
  const match = text.match(/^([\d,.]+)\s*([KkMm])?$/);
  if (!match) return null;
  const [, numberStr, suffix] = match;
  const baseNumber = parseFloat(numberStr.replace(/,/g, ""));
  if (isNaN(baseNumber)) return null;
  const multiplier = suffix ? suffix.toLowerCase() === "k" ? 1e3 : 1e6 : 1;
  return Math.floor(baseNumber * multiplier);
}
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
let styleElement = null;
let scanInterval = null;
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
        const userNamesEl = articleEl.querySelector('[data-testid="User-Names"]');
        let userName = "unknown";
        if (userNamesEl && userNamesEl.textContent) {
          const handleLine = userNamesEl.textContent.split("\n").find((s) => s.startsWith("@"));
          userName = handleLine || userNamesEl.textContent.split("\n")[0];
        }
        console.log(
          `Tweet Heat Map: Coloring tweet from ${userName} with ${className} (${viewCount} views)`
        );
      }
    }
    const timeElement = articleEl.querySelector("time");
    if (timeElement) {
      const isFresh = isTweetFresh(timeElement);
      updateFireEmoji(timeElement, isFresh);
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
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (settings.enabled) {
    injectStyles();
    if (scanInterval === null) {
      scanInterval = window.setInterval(scanExisting, 1e3);
    }
  } else {
    if (scanInterval !== null) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
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
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync" && changes["thm-settings"]) {
      const newSettings = changes["thm-settings"].newValue;
      if (newSettings) {
        settings = { ...settings, ...newSettings };
        updateExtensionState();
      }
    }
  });
}
function setupCleanup() {
  window.addEventListener("beforeunload", () => {
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
  });
}
async function init() {
  await loadSettings();
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
