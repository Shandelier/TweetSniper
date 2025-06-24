import { g as getNextKeywordColor } from "../utils.js";
const SETTINGS_KEY = "thm-settings";
const KEYWORDS_KEY = "thm-keywords";
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get([SETTINGS_KEY]);
    return result[SETTINGS_KEY] || { enabled: true };
  } catch (error) {
    console.error("Error loading settings:", error);
    return { enabled: true };
  }
}
async function saveSettings(settings) {
  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  } catch (error) {
    console.error("Error saving settings:", error);
  }
}
async function loadKeywords() {
  try {
    const result = await chrome.storage.sync.get([KEYWORDS_KEY]);
    return result[KEYWORDS_KEY] || [];
  } catch (error) {
    console.error("Error loading keywords:", error);
    return [];
  }
}
async function saveKeywords(keywords) {
  try {
    await chrome.storage.sync.set({ [KEYWORDS_KEY]: keywords });
  } catch (error) {
    console.error("Error saving keywords:", error);
  }
}
function updateToggleUI(enabled) {
  const toggle = document.getElementById("enabled-toggle");
  if (toggle) {
    toggle.checked = enabled;
  }
}
async function handleToggleChange(event) {
  const toggle = event.target;
  const settings = {
    enabled: toggle.checked
  };
  await saveSettings(settings);
  try {
    await chrome.action.setIcon({
      path: settings.enabled ? "icons/icon128.png" : "icons/icon128-disabled.png"
    });
  } catch (error) {
    console.debug("Could not update icon:", error);
  }
}
function renderKeywords(keywords) {
  const keywordList = document.getElementById("keyword-list");
  if (!keywordList) return;
  keywordList.innerHTML = "";
  keywords.forEach((keyword, index) => {
    const item = document.createElement("div");
    item.className = "keyword-item";
    item.innerHTML = `
      <span class="keyword-text">${keyword.text}</span>
      <div class="keyword-color" style="background-color: ${keyword.color}"></div>
      <button class="btn-remove" data-index="${index}">×</button>
    `;
    keywordList.appendChild(item);
  });
}
async function addKeyword(text) {
  const trimmedText = text.trim().toLowerCase();
  if (!trimmedText) return;
  const keywords = await loadKeywords();
  if (keywords.some((k) => k.text.toLowerCase() === trimmedText)) {
    return;
  }
  const newKeyword = {
    text: trimmedText,
    color: getNextKeywordColor(keywords),
    enabled: true
  };
  keywords.push(newKeyword);
  await saveKeywords(keywords);
  renderKeywords(keywords);
}
async function removeKeyword(index) {
  const keywords = await loadKeywords();
  keywords.splice(index, 1);
  await saveKeywords(keywords);
  renderKeywords(keywords);
}
async function handleKeywordSubmit() {
  const input = document.getElementById("keyword-input");
  if (!input) return;
  await addKeyword(input.value);
  input.value = "";
}
function setupKeywordListeners() {
  const addBtn = document.getElementById("add-keyword");
  if (addBtn) {
    addBtn.addEventListener("click", handleKeywordSubmit);
  }
  const input = document.getElementById("keyword-input");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleKeywordSubmit();
      }
    });
  }
  const keywordList = document.getElementById("keyword-list");
  if (keywordList) {
    keywordList.addEventListener("click", async (e) => {
      const target = e.target;
      if (target.classList.contains("btn-remove")) {
        const index = parseInt(target.getAttribute("data-index") || "0");
        await removeKeyword(index);
      }
    });
  }
}
async function initPopup() {
  try {
    const settings = await loadSettings();
    const keywords = await loadKeywords();
    updateToggleUI(settings.enabled);
    renderKeywords(keywords);
    const toggle = document.getElementById("enabled-toggle");
    if (toggle) {
      toggle.addEventListener("change", handleToggleChange);
    }
    setupKeywordListeners();
    console.debug("Popup initialized");
  } catch (error) {
    console.error("Error initializing popup:", error);
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}
