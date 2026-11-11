/**
 * Unicode normalization for Malayalam (and general) text.
 *
 * Keeps two versions of every string:
 *   - original_text: exactly as received (for citations / display)
 *   - normalized_text: NFC-normalized + invisible chars removed (for indexing/search)
 *
 * Any change is logged so you can debug why a query did or didn't match.
 */

export type NormalizationResult = {
  original: string;
  normalized: string;
  changed: boolean;
  changes: string[]; // human-readable descriptions of what changed
};

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;

/**
 * Removes invisible / control characters and returns (cleaned, descriptions).
 */
function stripInvisibleChars(text: string): { cleaned: string; descriptions: string[] } {
  const descriptions: string[] = [];
  let cleaned = text;

  const controlMatches = cleaned.match(CONTROL_CHARS);
  if (controlMatches && controlMatches.length > 0) {
    descriptions.push(`removed ${controlMatches.length} control character(s)`);
    cleaned = cleaned.replace(CONTROL_CHARS, "");
  }

  const zeroWidthMatches = cleaned.match(ZERO_WIDTH_CHARS);
  if (zeroWidthMatches && zeroWidthMatches.length > 0) {
    descriptions.push(`removed ${zeroWidthMatches.length} zero-width character(s)`);
    cleaned = cleaned.replace(ZERO_WIDTH_CHARS, "");
  }

  return { cleaned, descriptions };
}

/**
 * Normalize text for indexing/search.
 *
 * Steps:
 *   1. NFC — combine base letters + combining marks into single code points
 *   2. Strip invisible / control characters
 *   3. Collapse multiple whitespace into single spaces (keeps readability predictable)
 *
 * Returns both the original and normalized versions plus a change log.
 */
export function normalizeText(text: string): NormalizationResult {
  const original = text;
  const changes: string[] = [];

  // Step 1: NFC normalization. In Malayalam, this matters because conjuncts
  // (e.g. ക് + ഇ → കി) can be stored either pre-composed or decomposed.
  let normalized = original.normalize("NFC");
  if (normalized !== original) {
    changes.push("applied NFC Unicode normalization");
  }

  // Step 2: strip invisible / control characters.
  const { cleaned, descriptions } = stripInvisibleChars(normalized);
  normalized = cleaned;
  changes.push(...descriptions);

  // Step 3: collapse runs of whitespace into a single space.
  const collapsed = normalized.replace(/\s+/g, " ").trim();
  if (collapsed !== normalized) {
    changes.push("collapsed whitespace");
    normalized = collapsed;
  }

  return {
    original,
    normalized,
    changed: changes.length > 0,
    changes,
  };
}
