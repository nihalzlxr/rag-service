/**
 * seed-tenants.ts
 *
 * Creates 3 synthetic tenants, assigns corpus documents round-robin to them,
 * and generates an API key for each tenant.
 *
 * Reads JSONL files produced by `scripts/fetch-corpus.ts` from data/corpus/{en,ml}/.
 *
 * Usage:
 *   pnpm eval:seed
 */

import { randomUUID, createHash } from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db/client";
import { tenants, documents, apiKeys } from "@/lib/db/schema";

const CORPUS_DIR = path.resolve(process.cwd(), "data/corpus");

type CorpusDoc = {
  id: string;
  title: string;
  content: string;
  url: string;
  language: string;
};

function readCorpusDocs(): CorpusDoc[] {
  const docs: CorpusDoc[] = [];
  for (const language of ["en", "ml"] as const) {
    const dir = path.join(CORPUS_DIR, language);
    if (!fs.existsSync(dir)) {
      console.warn(`No corpus dir for ${language}: ${dir}`);
      continue;
    }
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          docs.push(JSON.parse(line) as CorpusDoc);
        } catch {
          console.warn(`Skipping malformed line in ${file}`);
        }
      }
    }
  }
  return docs;
}

function makeApiKey(tenantId: string): { plaintext: string; hash: string } {
  const plaintext = `sk-${tenantId.slice(0, 8)}-${randomUUID().slice(0, 12)}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

async function main(): Promise<void> {
  const docs = readCorpusDocs();
  if (docs.length === 0) {
    console.error(
      "No corpus docs found. Run `pnpm eval:fetch` first to download articles."
    );
    process.exit(1);
  }

  console.log(`Found ${docs.length} corpus documents.`);

  // 1. Create 3 synthetic tenants
  const tenantNames = ["Tenant Alpha", "Tenant Beta", "Tenant Gamma"];
  const tenantIds: string[] = [];

  for (const name of tenantNames) {
    const id = randomUUID();
    await db.insert(tenants).values({ id, name });
    tenantIds.push(id);
    console.log(`Created tenant "${name}" (${id})`);
  }

  // 2. Assign documents round-robin to tenants
  let docIndex = 0;
  for (const doc of docs) {
    const tenantId = tenantIds[docIndex % tenantIds.length];
    docIndex += 1;

    await db.insert(documents).values({
      id: randomUUID(),
      tenantId,
      title: doc.title,
      content: doc.content,
      source: doc.url,
      metadata: { language: doc.language, sourceId: doc.id },
    });
  }
  console.log(`Assigned ${docs.length} documents round-robin across ${tenantIds.length} tenants.`);

  // 3. Generate one API key per tenant
  console.log("\n=== API Keys (save these — they won't be shown again) ===\n");
  for (let i = 0; i < tenantIds.length; i++) {
    const { plaintext, hash } = makeApiKey(tenantIds[i]);
    await db.insert(apiKeys).values({
      id: randomUUID(),
      keyHash: hash,
      tenantId: tenantIds[i],
      roles: ["public"],
      name: `key-for-${tenantNames[i]}`,
    });
    console.log(`${tenantNames[i]}: ${plaintext}`);
  }
  console.log("\nDone. Use these keys with `Authorization: Bearer <key>` on API routes.");
}

main().catch((err) => {
  console.error("seed-tenants failed:", err);
  process.exit(1);
});
