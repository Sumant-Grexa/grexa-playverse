import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, tournaments } from "@playverse/db";
import { eq } from "drizzle-orm";
import { importSettledCsv } from "../src/lib/roster";

const here = dirname(fileURLToPath(import.meta.url));
const sampleDir = resolve(here, "../public/sample");

async function main() {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.name, "1.0"))
    .limit(1);
  const tournament =
    existing ??
    (
      await db.insert(tournaments).values({ name: "1.0", status: "active" }).returning()
    )[0];
  if (!tournament) throw new Error("Could not create tournament 1.0");
  if (tournament.status !== "active") {
    await db.update(tournaments).set({ status: "active" }).where(eq(tournaments.id, tournament.id));
  }

  const csvText = readFileSync(resolve(sampleDir, "settled.csv"), "utf8");
  const result = await importSettledCsv({
    tournamentId: tournament.id,
    csvText,
  });
  console.log(`Seeded ${tournament.name}: ${result.people} people`);
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
