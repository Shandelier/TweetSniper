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
const KEYWORD_COLORS = [
  "#FFD700",
  // Gold
  "#FF6B6B",
  // Red
  "#4ECDC4",
  // Teal
  "#45B7D1",
  // Blue
  "#96CEB4",
  // Green
  "#FFEAA7",
  // Yellow
  "#DDA0DD",
  // Plum
  "#F39C12"
  // Orange
];
function getNextKeywordColor(existingKeywords) {
  const usedColors = existingKeywords.map((k) => k.color);
  const availableColor = KEYWORD_COLORS.find((color) => !usedColors.includes(color));
  return availableColor || KEYWORD_COLORS[0];
}
function highlightKeywords(element, keywords) {
  if (!keywords.length) return;
  const enabledKeywords = keywords.filter((k) => k.enabled);
  if (!enabledKeywords.length) return;
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node2) => {
        const parent = node2.parentNode;
        if (parent && (parent.tagName === "MARK" || parent.tagName === "A" || parent.tagName === "BUTTON" || parent.closest("a, button"))) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  textNodes.forEach((textNode) => {
    var _a;
    let content = textNode.textContent || "";
    if (!content.trim()) return;
    let hasChanges = false;
    let newHTML = content;
    enabledKeywords.forEach((keyword) => {
      const regex = new RegExp(`\\b(${escapeRegex(keyword.text)})\\b`, "gi");
      const replacement = `<mark style="background-color: ${keyword.color}; padding: 1px 2px; border-radius: 2px;">$1</mark>`;
      if (regex.test(newHTML)) {
        newHTML = newHTML.replace(regex, replacement);
        hasChanges = true;
      }
    });
    if (hasChanges) {
      const span = document.createElement("span");
      span.innerHTML = newHTML;
      (_a = textNode.parentNode) == null ? void 0 : _a.replaceChild(span, textNode);
    }
  });
}
function removeKeywordHighlights(element) {
  const marks = element.querySelectorAll("mark");
  marks.forEach((mark) => {
    var _a;
    const textNode = document.createTextNode(mark.textContent || "");
    (_a = mark.parentNode) == null ? void 0 : _a.replaceChild(textNode, mark);
  });
  const spans = element.querySelectorAll("span:empty");
  spans.forEach((span) => span.remove());
}
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export {
  getNextKeywordColor as g,
  highlightKeywords as h,
  parseViews as p,
  removeKeywordHighlights as r
};
