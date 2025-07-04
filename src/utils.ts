/**
 * Parse view count text into a number
 * Handles formats: "1,234", "5.6 K", "1.2 M"
 */
export function parseViews(text: string): number | null {
  return parseCount(text);
}

/**
 * Generic count parser that handles various formats
 * Handles formats: "1,234", "5.6 K", "1.2 M", "1.5 B"
 */
export function parseCount(text: string): number | null {
  if (!text) return null;
  
  const match = text.match(/^([\d,.]+)\s*([KkMmBb])?$/);
  if (!match) return null;
  
  const [, numberStr, suffix] = match;
  const baseNumber = parseFloat(numberStr.replace(/,/g, ''));
  
  if (isNaN(baseNumber)) return null;
  
  let multiplier = 1;
  if (suffix) {
    const lowerSuffix = suffix.toLowerCase();
    if (lowerSuffix === 'k') multiplier = 1000;
    else if (lowerSuffix === 'm') multiplier = 1000000;
    else if (lowerSuffix === 'b') multiplier = 1000000000;
  }
  
  return Math.floor(baseNumber * multiplier);
}

export interface Keyword {
  text: string;
  color: string;
  enabled: boolean;
}

// Predefined colors for keyword highlighting
export const KEYWORD_COLORS = [
  '#FFD700', // Gold
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Plum
  '#F39C12', // Orange
];

/**
 * Get the next available color for a new keyword
 */
export function getNextKeywordColor(existingKeywords: Keyword[]): string {
  const usedColors = existingKeywords.map(k => k.color);
  const availableColor = KEYWORD_COLORS.find(color => !usedColors.includes(color));
  return availableColor || KEYWORD_COLORS[0];
}

/**
 * Highlight keywords in text content of an element
 */
export function highlightKeywords(element: HTMLElement, keywords: Keyword[]): void {
  if (!keywords.length) return;
  
  const enabledKeywords = keywords.filter(k => k.enabled);
  if (!enabledKeywords.length) return;
  
  // Walk through text nodes only
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Skip if parent is already a highlight or is a link/button
        const parent = node.parentNode as Element;
        if (parent && (
          parent.tagName === 'MARK' ||
          parent.tagName === 'A' ||
          parent.tagName === 'BUTTON' ||
          parent.closest('a, button')
        )) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes: Text[] = [];
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node as Text);
  }

  textNodes.forEach(textNode => {
    let content = textNode.textContent || '';
    if (!content.trim()) return;

    let hasChanges = false;
    let newHTML = content;

    enabledKeywords.forEach(keyword => {
      // Simple case-insensitive whole word matching
      const regex = new RegExp(`\\b(${escapeRegex(keyword.text)})\\b`, 'gi');
      const replacement = `<mark style="background-color: ${keyword.color}; padding: 1px 2px; border-radius: 2px;">$1</mark>`;
      
      if (regex.test(newHTML)) {
        newHTML = newHTML.replace(regex, replacement);
        hasChanges = true;
      }
    });

    if (hasChanges) {
      const span = document.createElement('span');
      span.innerHTML = newHTML;
      textNode.parentNode?.replaceChild(span, textNode);
    }
  });
}

/**
 * Remove all keyword highlights from an element
 */
export function removeKeywordHighlights(element: HTMLElement): void {
  // First, remove all mark elements by replacing them with their text content
  const marks = element.querySelectorAll('mark');
  marks.forEach(mark => {
    const textNode = document.createTextNode(mark.textContent || '');
    mark.parentNode?.replaceChild(textNode, mark);
  });
  
  // Then normalize the text nodes to merge adjacent text nodes
  element.normalize();
  
  // Find spans that were created by highlighting and contain only text
  const spans = element.querySelectorAll('span');
  spans.forEach(span => {
    // Check if this span was likely created by our highlighting
    // (contains only text nodes and no other elements)
    const hasOnlyTextContent = Array.from(span.childNodes).every(
      node => node.nodeType === Node.TEXT_NODE
    );
    
    if (hasOnlyTextContent && span.textContent) {
      // Replace the span with its text content
      const textNode = document.createTextNode(span.textContent);
      span.parentNode?.replaceChild(textNode, span);
    } else if (span.textContent === '') {
      // Remove empty spans
      span.remove();
    }
  });
  
  // Final normalization to clean up any fragmented text nodes
  element.normalize();
}

/**
 * Escape special regex characters
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
} 