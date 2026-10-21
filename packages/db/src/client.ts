import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  playverseSql?: ReturnType<typeof postgres>;
};

export async function closeDb() {
  if (globalForDb.playverseSql) {
    await globalForDb.playverseSql.end({ timeout: 5 });
    globalForDb.playverseSql = undefined;
  }
}

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!globalForDb.playverseSql) {
    globalForDb.playverseSql = postgres(url, { max: 10 });
  }
  return drizzle(globalForDb.playverseSql, { schema });
}

export type Database = ReturnType<typeof getDb>;
