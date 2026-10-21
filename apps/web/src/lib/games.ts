import {
  activityLog,
  browniePoints,
  gameStandings,
  games,
  getDb,
  tournamentTeams,
  tournaments,
} from "@playverse/db";
import { and, desc, eq } from "drizzle-orm";

export async function createGame(input: {
  name: string;
  startedOn: Date;
  endedOn: Date | null;
  maxScore: number;
}) {
  if (!input.name.trim()) throw new Error("Name the game");
  if (!Number.isInteger(input.maxScore) || input.maxScore <= 0) {
    throw new Error("Max score needs to be a whole number above zero");
  }
  if (Number.isNaN(input.startedOn.getTime())) throw new Error("Choose when the game started");
  const db = getDb();
  await db.transaction(async (tx) => {
    const [tournament] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.status, "active"))
      .orderBy(desc(tournaments.createdAt))
      .limit(1);
    if (!tournament) throw new Error("There is no live tournament");
    const teams = await tx
      .select({ id: tournamentTeams.id })
      .from(tournamentTeams)
      .where(eq(tournamentTeams.tournamentId, tournament.id));
    if (teams.length === 0) throw new Error("Import teams before adding a game");
    const [game] = await tx
      .insert(games)
      .values({
        tournamentId: tournament.id,
        name: input.name.trim(),
        startedOn: input.startedOn,
        endedOn: input.endedOn,
        maxScore: input.maxScore,
      })
      .returning();
    await tx.insert(gameStandings).values(
      teams.map((team) => ({
        gameId: game.id,
        tournamentTeamId: team.id,
        score: 0,
      })),
    );
    await tx.insert(activityLog).values({
      tournamentId: tournament.id,
      actor: "admin",
      action: "game.create",
      entityType: "game",
      entityId: game.id,
      payload: { name: game.name },
    });
  });
}

export async function saveGame(input: {
  gameId: string;
  scores: { standingId: string; score: number }[];
  brownies: { standingId: string; name: string; value: number }[];
}) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, input.gameId)).limit(1);
    if (!game) throw new Error("Game not found");
    const standings = await tx
      .select()
      .from(gameStandings)
      .where(eq(gameStandings.gameId, game.id));
    const standingIds = new Set(standings.map((standing) => standing.id));

    for (const score of input.scores) {
      if (!standingIds.has(score.standingId)) continue;
      if (!Number.isInteger(score.score)) throw new Error("Scores need to be whole numbers");
      await tx
        .update(gameStandings)
        .set({ score: score.score })
        .where(and(eq(gameStandings.id, score.standingId), eq(gameStandings.gameId, game.id)));
    }

    for (const standing of standings) {
      await tx.delete(browniePoints).where(eq(browniePoints.gameStandingId, standing.id));
    }
    const brownieRows = input.brownies.filter(
      (brownie) => brownie.name.trim() && standingIds.has(brownie.standingId),
    );
    for (const brownie of brownieRows) {
      if (!Number.isInteger(brownie.value)) {
        throw new Error("Brownie values need to be whole numbers");
      }
    }
    if (brownieRows.length > 0) {
      await tx.insert(browniePoints).values(
        brownieRows.map((brownie) => ({
          gameStandingId: brownie.standingId,
          name: brownie.name.trim(),
          value: brownie.value,
        })),
      );
    }
    await tx.insert(activityLog).values({
      tournamentId: game.tournamentId,
      actor: "admin",
      action: "game.save",
      entityType: "game",
      entityId: game.id,
      payload: { name: game.name },
    });
  });
}
