/**
 * Turns markdown that a model slipped into prose (bold, headings, bullets, links, code) into readable plain text.
 * Owners read these strings as-is and copy captions into WhatsApp or Instagram, where markdown shows as raw symbols.
 * Line breaks are kept; bullets become "• "; numbered lists stay as written.
 */
export function plainText(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    .replace(/\[([^\]\n]+)\]\((?:[^)\s]+)\)/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
