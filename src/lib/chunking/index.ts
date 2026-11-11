import { chunkMalayalam } from "./malayalam";
import { chunkEnglish } from "./english";

export { chunkMalayalam, chunkEnglish };

export type Language = "en" | "ml";

export function chunkText(text: string, language: Language): string[] {
  if (language === "ml") {
    return chunkMalayalam(text);
  }
  return chunkEnglish(text);
}
