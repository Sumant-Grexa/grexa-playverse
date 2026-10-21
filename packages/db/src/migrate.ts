import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const folder = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

function waitingForDatabase(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout|starting up|connection/i.test(message);
}

for (let attempt = 1; attempt <= 30; attempt += 1) {
  const sql = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: folder });
    await sql.end();
    console.log("migrations applied");
    process.exit(0);
  } catch (error) {
    await sql.end({ timeout: 1 }).catch(() => undefined);
    if (!waitingForDatabase(error) || attempt === 30) {
      console.error(error);
      process.exit(1);
    }
    console.log(`database not ready (${attempt}/30)`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
  }
}
