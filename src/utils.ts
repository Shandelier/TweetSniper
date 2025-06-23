/**
 * Parse view count text into a number
 * Handles formats: "1,234", "5.6 K", "1.2 M"
 */
export function parseViews(text: string): number | null {
  if (!text) return null;
  
  const match = text.match(/^([\d,.]+)\s*([KkMm])?$/);
  if (!match) return null;
  
  const [, numberStr, suffix] = match;
  const baseNumber = parseFloat(numberStr.replace(/,/g, ''));
  
  if (isNaN(baseNumber)) return null;
  
  const multiplier = suffix ? (suffix.toLowerCase() === 'k' ? 1000 : 1000000) : 1;
  return Math.floor(baseNumber * multiplier);
} 