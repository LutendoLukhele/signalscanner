/**
 * Shared data-quality helpers used by all scrapers and the scorer.
 */

/** Maximum number of characters to retain from any scraped text body. */
export const MAX_TEXT_CHARS = 2000;

/**
 * Normalise whitespace and decode the most common HTML entities found in
 * scraped content so downstream storage and scoring work on clean strings.
 */
export function sanitizeText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')   // process &amp; last to avoid double-unescaping
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * Return true when a Reddit (or any) post body / author is a deletion or
 * removal placeholder — these contain zero useful signal.
 */
export function isDeletedContent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === '[deleted]' || t === '[removed]' || t === '';
}

/**
 * Validate that a string is an absolute http(s) URL.
 * Returns false for relative paths, empty strings, or non-http schemes.
 */
export function isValidHttpUrl(str: string): boolean {
  if (!str) return false;
  try {
    const { protocol } = new URL(str);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Safely parse a date string.
 * - Returns `new Date()` (now) when the string is absent or produces an
 *   invalid date — so the lead is treated as "just seen".
 * - Caps any future timestamp to now (clock skew / bad data).
 */
export function parseDate(dateStr: string | undefined | null): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date();
  return d > new Date() ? new Date() : d;
}
