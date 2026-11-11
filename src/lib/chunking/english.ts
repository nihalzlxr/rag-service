const MAX_CHARS = 1000;
const OVERLAP = 200;

function trim(s: string): string {
  return s.replace(/^\s+|\s+$/g, "");
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => trim(s))
    .filter(Boolean);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((s) => trim(s))
    .filter(Boolean);
}

function splitChars(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    parts.push(text.slice(i, i + maxChars));
  }
  return parts;
}

function recursiveSplit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const sentences = splitSentences(text);
  if (sentences.length > 1) {
    const chunks: string[] = [];
    let current = "";
    for (const s of sentences) {
      const next = current.length === 0 ? s : current + " " + s;
      if (next.length > maxChars) {
        if (current.length > 0) {
          chunks.push(current);
          current = s;
        } else {
          chunks.push(...recursiveSplit(s, maxChars));
        }
      } else {
        current = next;
      }
    }
    if (current.length > 0) {
      chunks.push(current);
    }
    return chunks;
  }

  const paragraphs = splitParagraphs(text);
  if (paragraphs.length > 1) {
    return recursiveSplit(paragraphs.join("\n\n"), maxChars);
  }

  return splitChars(text, maxChars);
}

export function chunkEnglish(text: string): string[] {
  const trimmed = trim(text);
  if (trimmed.length === 0) {
    return [];
  }

  const baseChunks = recursiveSplit(trimmed, MAX_CHARS);
  const chunks: string[] = [];

  for (let i = 0; i < baseChunks.length; i++) {
    let chunk = baseChunks[i];
    if (i > 0 && chunks.length > 0) {
      const prev = chunks[chunks.length - 1];
      const overlap = prev.slice(-OVERLAP);
      chunk = overlap + (overlap.length > 0 ? " " : "") + chunk;
    }
    chunks.push(chunk);
  }

  return chunks;
}
