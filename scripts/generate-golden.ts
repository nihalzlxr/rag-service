/**
 * generate-golden.ts
 *
 * Builds the golden evaluation set from the downloaded corpus.
 *
 * Each item references a source document + a verbatim answer passage
 * (NOT chunk IDs), so chunking changes never break the eval.
 *
 * Output:
 *   eval/golden/en.json  (30 questions)
 *   eval/golden/ml.json  (30 questions)
 *
 * Usage:
 *   pnpm eval:golden
 */

import fs from "fs";
import path from "path";

const CORPUS_DIR = path.resolve(process.cwd(), "data/corpus");
const GOLDEN_DIR = path.resolve(process.cwd(), "eval/golden");
const PER_LANGUAGE = 30;

type CorpusDoc = {
  id: string;
  title: string;
  content: string;
  url: string;
  language: string;
};

type GoldenItem = {
  id: string;
  question: string;
  language: "en" | "ml";
  answer_passage: string;
  source_doc_id: string;
  source_doc_title: string;
  tenant_id: string;
  difficulty?: "easy" | "medium" | "hard";
};

function readCorpusDocs(language: "en" | "ml"): CorpusDoc[] {
  const dir = path.join(CORPUS_DIR, language);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const docs: CorpusDoc[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".jsonl")) continue;
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const doc = JSON.parse(line) as CorpusDoc;
        if (doc.language === language) {
          docs.push(doc);
        }
      } catch {
        // skip malformed lines
      }
    }
  }
  return docs;
}

/**
 * Split text into sentences. Handles both English and Malayalam.
 * Falls back to splitting on periods / Malayalam danda (।) / double-newline.
 */
function splitSentences(text: string): string[] {
  // Normalize whitespace first
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  // Malayalam sentence delimiter: danda (।) and double danda (॥)
  // English: . ! ?
  const parts = cleaned.split(/([.!?।॥])\s+/);
  const sentences: string[] = [];
  let current = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (/^[.!?।॥]$/.test(part)) {
      current = (current + part).trim();
      if (current.length > 0) {
        sentences.push(current);
        current = "";
      }
    } else {
      current = current ? current + " " + part : part;
    }
  }
  if (current.trim().length > 0) {
    sentences.push(current.trim());
  }

  return sentences.filter((s) => s.length > 0);
}

/**
 * Pick answer-passage candidates: sentences that are long enough to be
 * meaningful but short enough to be a focused answer.
 */
function pickPassages(sentences: string[]): string[] {
  return sentences.filter((s) => s.length >= 60 && s.length <= 400);
}

/**
 * Build a simple question from a passage.
 * Heuristics based on what kind of info the passage contains.
 */
function buildQuestion(passage: string, docTitle: string): string {
  const lower = passage.toLowerCase();

  // Year/date patterns -> "When" question
  if (/\b(18|19|20)\d{2}\b/.test(passage)) {
    return `When did the event described in "${docTitle}" occur?`;
  }

  // "is" / "are" definitions -> "What is" question
  if (/\b(is|are|was|were)\b/.test(lower)) {
    return `What does "${docTitle}" say about the topic?`;
  }

  // Contains numbers -> "How many / what number" question
  if (/\d/.test(passage)) {
    return `What numbers or figures does "${docTitle}" mention?`;
  }

  // Default
  return `What information does "${docTitle}" provide about this topic?`;
}

function assignDifficulty(index: number): "easy" | "medium" | "hard" {
  if (index < 10) return "easy";
  if (index < 20) return "medium";
  return "hard";
}

function main(): void {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  // Tenant IDs from seeding (read from env or use round-robin placeholders).
  // In production these come from the seeded database. Here we use stable
  // UUIDs so the golden set is reproducible.
  const tenantIds = [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "cccccccc-cccc-cccc-cccc-cccccccccccc",
  ];

  for (const language of ["en", "ml"] as const) {
    const docs = readCorpusDocs(language);
    console.log(`${language.toUpperCase()}: found ${docs.length} corpus documents`);

    const items: GoldenItem[] = [];
    let itemIndex = 0;

    for (const doc of docs) {
      if (items.length >= PER_LANGUAGE) break;

      const sentences = splitSentences(doc.content);
      const passages = pickPassages(sentences);

      for (const passage of passages) {
        if (items.length >= PER_LANGUAGE) break;

        items.push({
          id: `golden-${language}-${String(itemIndex + 1).padStart(3, "0")}`,
          question: buildQuestion(passage, doc.title),
          language,
          answer_passage: passage,
          source_doc_id: doc.id,
          source_doc_title: doc.title,
          tenant_id: tenantIds[itemIndex % tenantIds.length],
          difficulty: assignDifficulty(itemIndex),
        });
        itemIndex += 1;
      }
    }

    if (items.length < PER_LANGUAGE) {
      console.warn(
        `Warning: only ${items.length} golden items generated for ${language} (wanted ${PER_LANGUAGE})`
      );
    }

    const outFile = path.join(GOLDEN_DIR, `${language}.json`);
    fs.writeFileSync(outFile, JSON.stringify(items, null, 2) + "\n");
    console.log(`Wrote ${items.length} golden items to ${outFile}`);
  }

  console.log("Golden set generation complete.");
}

main();
