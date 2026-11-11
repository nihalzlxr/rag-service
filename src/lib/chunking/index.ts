import { chunkMalayalam } from "./malayalam";
import { chunkEnglish } from "./english";
import { normalizeText, type NormalizationResult } from "./normalize";

export { chunkMalayalam, chunkEnglish, normalizeText };
export type { NormalizationResult };

export type Language = "en" | "ml";

export function chunkText(text: string, language: Language): string[] {
  if (language === "ml") {
    return chunkMalayalam(text);
  }
  return chunkEnglish(text);
}
