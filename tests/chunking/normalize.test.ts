import { describe, it, expect } from "vitest";
import { normalizeText } from "@/lib/chunking/normalize";

describe("Unicode normalization", () => {
  it("returns unchanged text when nothing needs normalizing", () => {
    const result = normalizeText("hello world");
    expect(result.original).toBe("hello world");
    expect(result.normalized).toBe("hello world");
    expect(result.changed).toBe(false);
    expect(result.changes).toEqual([]);
  });

  it("applies NFC normalization safely to combining sequences", () => {
    // "അ" + vowel sign AI (U+0D48) is a combining sequence. NFC does not have a
    // precomposed form for most Malayalam consonant+vowel pairs, so the string
    // is unchanged — but normalization must not crash and must report no change.
    const decomposed = "അ" + "\u0D48";
    const result = normalizeText(decomposed);
    expect(result.changed).toBe(false);
    expect(result.normalized).toBe(decomposed);
  });

  it("reports NFC when it actually changes text (Latin example)", () => {
    // "Å" can be stored as A + combining ring (U+030A); NFC recomposes to a single code point.
    const decomposed = "A" + "\u030A";
    const result = normalizeText(decomposed);
    expect(result.changed).toBe(true);
    expect(result.changes.some((c) => c.includes("NFC"))).toBe(true);
    expect(result.normalized).toBe("Å");
  });

  it("removes zero-width characters and logs the change", () => {
    const text = "ഹലോ\u200Bലോ"; // zero-width space between letters
    const result = normalizeText(text);
    expect(result.changed).toBe(true);
    expect(result.normalized).toBe("ഹലോലോ");
    expect(result.changes.some((c) => c.includes("zero-width"))).toBe(true);
  });

  it("removes control characters and logs the change", () => {
    const text = "ഹലോ\u0000ലോ"; // null control char
    const result = normalizeText(text);
    expect(result.changed).toBe(true);
    expect(result.normalized).toBe("ഹലോലോ");
    expect(result.changes.some((c) => c.includes("control"))).toBe(true);
  });

  it("collapses multiple whitespace into single spaces", () => {
    const text = "ഹലോ   ലോ";
    const result = normalizeText(text);
    expect(result.normalized).toBe("ഹലോ ലോ");
    expect(result.changes.some((c) => c.includes("whitespace"))).toBe(true);
  });

  it("keeps original unchanged even after normalization", () => {
    const text = "ഹലോ\u200Bലോ";
    const result = normalizeText(text);
    expect(result.original).toBe(text);
  });
});
