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
  const logos = new Map<string, Buffer>();
  for (const name of ["paper-boats.svg", "night-shift.svg", "slow-jam.svg"]) {
    const bytes = readFileSync(resolve(sampleDir, "logos", name));
    logos.set(name, bytes);
  }
  const result = await importSettledCsv({
    tournamentId: tournament.id,
    csvText,
    logos,
  });
  console.log(`Seeded ${tournament.name}: ${result.people} people, ${result.teams} teams`);
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
