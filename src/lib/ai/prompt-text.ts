export function redactAiText(text: string): string {
  return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[contact removed]")
    .replace(/\bBearer\s+[\w.-]+/gi, "[credential removed]")
    .replace(/\b(?:api[_ -]?key|server[_ -]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[credential removed]")
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[contact removed]");
}
