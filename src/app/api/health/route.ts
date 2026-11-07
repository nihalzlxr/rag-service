import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
  lazyConnect: true,
});

export async function GET() {
  const results = { db: "unknown", redis: "unknown" };

  try {
    await db.execute(sql`SELECT 1`);
    results.db = "ok";
  } catch {
    results.db = "error";
  }

  try {
    await redis.connect();
    await redis.ping();
    results.redis = "ok";
    await redis.quit();
  } catch {
    results.redis = "error";
  }

  const status = results.db === "ok" && results.redis === "ok" ? 200 : 503;
  return NextResponse.json(results, { status });
}