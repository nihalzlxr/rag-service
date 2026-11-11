/**
 * fetch-corpus.ts
 *
 * Downloads public English + Malayalam articles from Wikipedia and writes them
 * as JSONL to data/corpus/{en,ml}/.
 *
 * Each line: { id, title, content, url, language }
 *
 * Wikipedia is public and needs no API key. We add a small delay between
 * requests to be polite to their servers.
 *
 * Usage:
 *   pnpm eval:fetch
 */

import fs from "fs";
import path from "path";

const CORPUS_DIR = path.resolve(process.cwd(), "data/corpus");
const PER_LANGUAGE = 20; // articles per language
const DELAY_MS = 1000; // be polite: 1 request/second

type WikiPage = {
  id: string;
  title: string;
  content: string;
  url: string;
  language: "en" | "ml";
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      // Wikipedia requires a descriptive User-Agent
      "User-Agent": "rag-service/0.1.0 (https://example.org; contact@example.org)",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

async function searchWikipedia(
  language: "en" | "ml",
  query: string
): Promise<string[]> {
  const domain = language === "en" ? "en.wikipedia.org" : "ml.wikipedia.org";
  const url =
    `https://${domain}/w/api.php` +
    `?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
    `&format=json&srlimit=${PER_LANGUAGE}`;

  const data = await fetchJson<{
    query: { search: Array<{ title: string }> };
  }>(url);

  return data.query.search.map((item) => item.title);
}

async function fetchExtracts(
  language: "en" | "ml",
  titles: string[]
): Promise<WikiPage[]> {
  const domain = language === "en" ? "en.wikipedia.org" : "ml.wikipedia.org";
  const pages: WikiPage[] = [];

  // Wikipedia lets us fetch multiple titles at once using the pipe separator.
  // Batch in groups of 20 to keep URLs reasonable.
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const url =
      `https://${domain}/w/api.php` +
      `?action=query&prop=extracts&explaintext=1` +
      `&titles=${encodeURIComponent(batch.join("|"))}` +
      `&format=json&redirects=1`;

    const data = await fetchJson<{
      query: { pages: Record<string, { pageid: number; title: string; extract?: string }> };
    }>(url);

    for (const [, page] of Object.entries(data.query.pages)) {
      if (!page.extract || page.extract.trim().length === 0) {
        continue;
      }
      pages.push({
        id: `wiki-${language}-${page.pageid}`,
        title: page.title,
        content: page.extract.trim(),
        url: `https://${domain}/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        language,
      });
    }

    await sleep(DELAY_MS);
  }

  return pages;
}

function writeJsonl(language: "en" | "ml", pages: WikiPage[]): void {
  const dir = path.join(CORPUS_DIR, language);
  fs.mkdirSync(dir, { recursive: true });

  // Use a timestamped filename so re-runs don't clobber previous data
  const file = path.join(dir, `wikipedia-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const lines = pages.map((p) => JSON.stringify(p));
  fs.writeFileSync(file, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
  console.log(`Wrote ${pages.length} ${language} articles to ${file}`);
}

async function main(): Promise<void> {
  // Search topics chosen to give a broad mix of subjects in each language.
  const topics: Record<"en" | "ml", string[]> = {
    en: [
      "artificial intelligence",
      "climate change",
      "World War II",
      "photosynthesis",
      "Indian Constitution",
      "Mahatma Gandhi",
      "The Great Gatsby",
      "quantum mechanics",
      "Internet",
      "vaccine",
    ],
    ml: [
      "ഇന്ത്യ",
      "കേരളം",
      "ഇന്റർനെറ്റ്",
      "മലയാളം ഭാഷ",
      "ചന്ദ്രയാൻ",
      "വിക്കിപീഡിയ",
    ],
  };

  for (const language of ["en", "ml"] as const) {
    console.log(`Fetching ${language} articles...`);
    const allTitles = new Set<string>();

    for (const topic of topics[language]) {
      try {
        const titles = await searchWikipedia(language, topic);
        for (const t of titles) {
          allTitles.add(t);
        }
        await sleep(DELAY_MS);
      } catch (err) {
        console.warn(`Skipping topic "${topic}" for ${language}: ${err}`);
      }
    }

    const pages = await fetchExtracts(language, Array.from(allTitles));
    writeJsonl(language, pages);
  }

  console.log("Corpus fetch complete.");
}

main().catch((err) => {
  console.error("fetch-corpus failed:", err);
  process.exit(1);
});
