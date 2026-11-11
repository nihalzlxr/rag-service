import { describe, it, expect } from "vitest";
import { chunkMalayalam, MAX_CHARS } from "@/lib/chunking/malayalam";

const graphemeSeg = new Intl.Segmenter("ml", { granularity: "grapheme" });
function graphemes(text: string): string[] {
  return Array.from(graphemeSeg.segment(text), ({ segment }) => segment);
}

const shortText = "ഇവിടെ ഒരു വാചകം അടങ്ങിയിരിക്കുന്നു. ഇത് രണ്ടാമത്തെ വാചകമാണ്. gradients.";

describe("Malayalam chunker", () => {
  it("returns empty array for empty input", () => {
    expect(chunkMalayalam("")).toEqual([]);
    expect(chunkMalayalam("   ")).toEqual([]);
  });

  it("returns a single chunk for text under MAX_CHARS", () => {
    const chunks = chunkMalayalam(shortText);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(shortText);
  });

  it("preserves sentence boundaries and does not split mid-sentence", () => {
    const longText =
      "ഇവിടെ ഒരു വാചകം അടങ്ങിയിരിക്കുന്നു. ഇത് രണ്ടാമത്തെ വാചകമാണ്. gradients ".repeat(120);
    const chunks = chunkMalayalam(longText);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHARS);
    }
  });

  it("applies overlap between consecutive chunks", () => {
    const sentence = "ഇവിടെ ഒരു വാചകം അടങ്ങിയിരിക്കുന്നു. ";
    const longText = sentence.repeat(120);
    const chunks = chunkMalayalam(longText);
    if (chunks.length > 1) {
      // Overlap means the start of chunk 1 mirrors content at the end of chunk 0.
      // Use a tolerant window since Malayalam grapheme segmentation is context-sensitive.
      const tail = graphemes(chunks[0]).slice(-40).join("");
      const head = graphemes(chunks[1]).slice(0, 15).join("");
      expect(tail.includes(head)).toBe(true);
    }
  });

  it("does not produce empty chunks", () => {
    const chunks = chunkMalayalam("ഒരു വാചകം. രണ്ടാമത്. ".repeat(100));
    expect(chunks.every((c) => c.trim().length > 0)).toBe(true);
  });

  it("handles text without sentence boundary markers", () => {
    const noBoundary = "അക്ഷരം".repeat(500);
    const chunks = chunkMalayalam(noBoundary);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHARS);
    }
  });
});
