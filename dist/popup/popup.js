const STORAGE_KEY = "thm-settings";
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get([STORAGE_KEY]);
    return result[STORAGE_KEY] || { enabled: true };
  } catch (error) {
    console.error("Error loading settings:", error);
    return { enabled: true };
  }
}
async function saveSettings(settings) {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  } catch (error) {
    console.error("Error saving settings:", error);
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
async function initPopup() {
  try {
    const settings = await loadSettings();
    updateToggleUI(settings.enabled);
    const toggle = document.getElementById("enabled-toggle");
    if (toggle) {
      toggle.addEventListener("change", handleToggleChange);
    }
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
