const MAX_CHARS = 1000;
const OVERLAP = 200;

export { MAX_CHARS, OVERLAP };

let sentenceSegmenter: Intl.Segmenter | null = null;
let graphemeSegmenter: Intl.Segmenter | null = null;

function getSentenceSegmenter(): Intl.Segmenter | null {
  if (sentenceSegmenter !== undefined) {
    return sentenceSegmenter;
  }
  try {
    sentenceSegmenter = new Intl.Segmenter("ml", { granularity: "sentence" });
  } catch {
    sentenceSegmenter = null;
  }
  return sentenceSegmenter;
}

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter !== undefined) {
    return graphemeSegmenter;
  }
  try {
    graphemeSegmenter = new Intl.Segmenter("ml", { granularity: "grapheme" });
  } catch {
    graphemeSegmenter = null;
  }
  return graphemeSegmenter;
}

function graphemeClusters(text: string): string[] {
  const seg = getGraphemeSegmenter();
  if (!seg) {
    return [text];
  }
  const clusters: string[] = [];
  for (const { segment } of seg.segment(text)) {
    clusters.push(segment);
  }
  return clusters;
}

function lastNGraphemes(text: string, n: number): string {
  const clusters = graphemeClusters(text);
  if (clusters.length <= n) {
    return text;
  }
  return clusters.slice(clusters.length - n).join("");
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n\n+/);
}

function trim(s: string): string {
  return s.replace(/^\s+|\s+$/g, "");
}

function splitChars(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    parts.push(text.slice(i, i + maxChars));
  }
  return parts;
}

export function chunkMalayalam(text: string): string[] {
  const trimmed = trim(text);
  if (trimmed.length === 0) {
    return [];
  }

  const paragraphs = splitParagraphs(trimmed);
  const chunks: string[] = [];
  let current = "";

  const seg = getSentenceSegmenter();

  for (const para of paragraphs) {
    const paraTrimmed = trim(para);
    if (paraTrimmed.length === 0) {
      continue;
    }

    const sentences: string[] = [];
    if (seg) {
      for (const { segment } of seg.segment(paraTrimmed)) {
        const t = trim(segment);
        if (t.length > 0) {
          sentences.push(t);
        }
      }
    } else {
      sentences.push(paraTrimmed);
    }

    for (const sentence of sentences) {
      if (sentence.length > MAX_CHARS) {
        if (current.length > 0) {
          chunks.push(current);
          current = "";
        }
        const pieces = splitChars(sentence, MAX_CHARS);
        for (const piece of pieces) {
          if (current.length === 0) {
            current = piece;
          } else {
            chunks.push(current);
            current = piece;
          }
        }
        continue;
      }

      if (current.length + sentence.length + 1 > MAX_CHARS && current.length > 0) {
        chunks.push(current);
        const overlap = lastNGraphemes(current, OVERLAP);
        current = overlap + (overlap.length > 0 ? " " : "") + sentence;
      } else {
        current = current.length === 0 ? sentence : current + " " + sentence;
      }
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
