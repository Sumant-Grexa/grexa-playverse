import {
  activityLog,
  auctionState,
  bids,
  captaincies,
  getDb,
  people,
  squadMembers,
  tournamentPlayers,
  tournamentTeams,
  tournaments,
} from "@playverse/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { column, hasColumn, parseCsv } from "./csv";
import { safeName, saveUpload } from "./uploads";

const KNOWN = new Set([
  "name",
  "wantstobecaptain",
  "iscaptain",
  "teamname",
  "teamlogo",
  "openingbalance",
]);

function flag(value: string) {
  const text = value.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(text)) return true;
  if (["false", "no", "n", "0", ""].includes(text)) return false;
  return null;
}

export async function importSettledCsv(input: {
  tournamentId: string;
  csvText: string;
  logos: Map<string, Buffer>;
}) {
  const db = getDb();
  const parsed = parseCsv(input.csvText);
  if (parsed.length === 0) throw new Error("The CSV has no people");

  const includeBalance = hasColumn(parsed, "openingBalance");
  const rows = parsed.map((row, index) => {
    const name = column(row, "name").trim();
    if (!name) throw new Error(`Row ${index + 2} is missing a name`);
    const wants = flag(column(row, "wantsToBeCaptain"));
    const captain = flag(column(row, "isCaptain"));
    if (wants == null) throw new Error(`${name} has an invalid wantsToBeCaptain value`);
    if (captain == null) throw new Error(`${name} has an invalid isCaptain value`);
    const teamName = column(row, "teamName").trim();
    const teamLogo = column(row, "teamLogo").trim();
    if (captain && !teamName) throw new Error(`${name} is a captain and needs a team name`);
    let openingBalance: number | null = null;
    if (includeBalance && captain) {
      const raw = column(row, "openingBalance").trim();
      if (raw) {
        if (!/^\d+$/.test(raw)) throw new Error(`${teamName} has an invalid opening balance`);
        openingBalance = Number(raw);
      }
    }
    const formAnswers: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (KNOWN.has(key.toLowerCase())) continue;
      if (value.trim()) formAnswers[key] = value.trim();
    }
    return { name, wants, captain, teamName, teamLogo, openingBalance, formAnswers, index };
  });

  const captainTeams = new Set<string>();
  for (const row of rows) {
    if (!row.captain) continue;
    const key = row.teamName.toLowerCase();
    if (captainTeams.has(key)) throw new Error(`Two captains are listed for ${row.teamName}`);
    captainTeams.add(key);
    if (row.teamLogo && !input.logos.has(row.teamLogo) && !input.logos.has(safeName(row.teamLogo))) {
      throw new Error(`Upload the logo file ${row.teamLogo}`);
    }
  }

  const names = new Set<string>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (names.has(key)) throw new Error(`${row.name} appears more than once`);
    names.add(key);
  }

  await db.transaction(async (tx) => {
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(eq(tournaments.id, input.tournamentId))
      .limit(1);
    if (!tournament) throw new Error("Tournament not found");

    await tx.execute(sql`select id from tournaments where id = ${input.tournamentId} for update`);

    await tx.execute(sql`
      delete from brownie_points
      where game_standing_id in (
        select game_standings.id
        from game_standings
        join games on games.id = game_standings.game_id
        where games.tournament_id = ${input.tournamentId}
      )
    `);
    await tx.execute(sql`
      delete from game_standings
      where game_id in (select id from games where tournament_id = ${input.tournamentId})
    `);
    await tx.execute(sql`delete from games where tournament_id = ${input.tournamentId}`);
    await tx.execute(sql`delete from bids where tournament_id = ${input.tournamentId}`);
    await tx.execute(sql`
      delete from squad_members
      where tournament_team_id in (
        select id from tournament_teams where tournament_id = ${input.tournamentId}
      )
    `);
    await tx.execute(sql`
      delete from captaincies
      where tournament_team_id in (
        select id from tournament_teams where tournament_id = ${input.tournamentId}
      )
    `);
    await tx.execute(sql`delete from auction_state where tournament_id = ${input.tournamentId}`);
    await tx.execute(sql`delete from tournament_players where tournament_id = ${input.tournamentId}`);
    await tx.execute(sql`delete from tournament_teams where tournament_id = ${input.tournamentId}`);

    const existingPeople = await tx.select().from(people);
    const peopleByName = new Map(
      existingPeople.map((person) => [person.name.trim().toLowerCase(), person]),
    );

    const playerIds = new Map<string, { personId: string; tournamentPlayerId: string }>();
    for (const row of rows) {
      let person = peopleByName.get(row.name.toLowerCase());
      if (!person) {
        const [created] = await tx.insert(people).values({ name: row.name }).returning();
        person = created;
        peopleByName.set(row.name.toLowerCase(), created);
      } else if (person.name !== row.name) {
        await tx.update(people).set({ name: row.name }).where(eq(people.id, person.id));
      }
      const [player] = await tx
        .insert(tournamentPlayers)
        .values({
          tournamentId: input.tournamentId,
          personId: person.id,
          wantsToBeCaptain: row.wants,
          formAnswers: row.formAnswers,
          auctionOrder: row.index,
          status: "available",
        })
        .returning();
      playerIds.set(row.name.toLowerCase(), {
        personId: person.id,
        tournamentPlayerId: player.id,
      });
    }

    let sortOrder = 0;
    for (const row of rows.filter((item) => item.captain)) {
      let logoPath: string | null = null;
      if (row.teamLogo) {
        const file = input.logos.get(row.teamLogo) ?? input.logos.get(safeName(row.teamLogo));
        if (file) {
          logoPath = await saveUpload(
            `logos/${input.tournamentId}/${safeName(row.teamLogo)}`,
            file,
          );
        }
      }
      const [team] = await tx
        .insert(tournamentTeams)
        .values({
          tournamentId: input.tournamentId,
          name: row.teamName,
          logoPath,
          openingBalance: row.openingBalance,
          sortOrder,
        })
        .returning();
      sortOrder += 1;
      const ids = playerIds.get(row.name.toLowerCase());
      if (!ids) throw new Error(`Missing captain ${row.name}`);
      await tx.insert(captaincies).values({
        tournamentTeamId: team.id,
        personId: ids.personId,
      });
    }

    await tx.insert(auctionState).values({
      tournamentId: input.tournamentId,
      status: "idle",
    });

    await tx.insert(activityLog).values({
      tournamentId: input.tournamentId,
      actor: "admin",
      action: "roster.import",
      entityType: "tournament",
      entityId: input.tournamentId,
      payload: {
        people: rows.length,
        teams: rows.filter((row) => row.captain).length,
      },
    });
  });

  return {
    people: rows.length,
    teams: rows.filter((row) => row.captain).length,
  };
}

export async function reassignCaptain(input: {
  tournamentId: string;
  teamId: string;
  personId: string;
}) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from tournaments where id = ${input.tournamentId} for update`);
    const [team] = await tx
      .select()
      .from(tournamentTeams)
      .where(
        and(eq(tournamentTeams.id, input.teamId), eq(tournamentTeams.tournamentId, input.tournamentId)),
      )
      .limit(1);
    if (!team) throw new Error("Team not found");

    const [player] = await tx
      .select()
      .from(tournamentPlayers)
      .where(
        and(
          eq(tournamentPlayers.tournamentId, input.tournamentId),
          eq(tournamentPlayers.personId, input.personId),
        ),
      )
      .limit(1);
    if (!player) throw new Error("That person is not in this tournament");

    const [person] = await tx.select().from(people).where(eq(people.id, input.personId)).limit(1);
    const now = new Date();
    const [previous] = await tx
      .select({ personId: captaincies.personId })
      .from(captaincies)
      .where(and(eq(captaincies.tournamentTeamId, input.teamId), isNull(captaincies.endedAt)))
      .limit(1);

    await tx
      .update(captaincies)
      .set({ endedAt: now })
      .where(and(eq(captaincies.tournamentTeamId, input.teamId), isNull(captaincies.endedAt)));
    await tx
      .update(captaincies)
      .set({ endedAt: now })
      .where(and(eq(captaincies.personId, input.personId), isNull(captaincies.endedAt)));
    await tx.insert(captaincies).values({
      tournamentTeamId: input.teamId,
      personId: input.personId,
      startedAt: now,
    });

    if (player.status === "on_block") {
      await tx
        .update(tournamentPlayers)
        .set({ status: "available" })
        .where(eq(tournamentPlayers.id, player.id));
      await tx
        .update(auctionState)
        .set({
          status: "idle",
          tournamentPlayerId: null,
          currentAmount: null,
          currentTeamId: null,
          updatedAt: now,
        })
        .where(eq(auctionState.tournamentId, input.tournamentId));
    }

    await tx.insert(activityLog).values({
      tournamentId: input.tournamentId,
      actor: "admin",
      action: "captain.reassign",
      entityType: "team",
      entityId: input.teamId,
      payload: {
        teamName: team.name,
        captainName: person?.name ?? "",
        previousPersonId: previous?.personId ?? null,
      },
    });
  });
}

export async function removeSquadMember(input: {
  tournamentId: string;
  teamId: string;
  tournamentPlayerId: string;
}) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from tournaments where id = ${input.tournamentId} for update`);
    const [seat] = await tx
      .select({
        id: squadMembers.id,
        name: people.name,
        personId: people.id,
        teamName: tournamentTeams.name,
      })
      .from(squadMembers)
      .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, squadMembers.tournamentPlayerId))
      .innerJoin(people, eq(people.id, tournamentPlayers.personId))
      .innerJoin(tournamentTeams, eq(tournamentTeams.id, squadMembers.tournamentTeamId))
      .where(
        and(
          eq(squadMembers.tournamentTeamId, input.teamId),
          eq(squadMembers.tournamentPlayerId, input.tournamentPlayerId),
          eq(tournamentTeams.tournamentId, input.tournamentId),
          isNull(squadMembers.leftAt),
        ),
      )
      .limit(1);
    if (!seat) throw new Error("That player is not on this team");

    const [won] = await tx
      .select()
      .from(bids)
      .where(
        and(
          eq(bids.tournamentPlayerId, input.tournamentPlayerId),
          eq(bids.tournamentTeamId, input.teamId),
          eq(bids.status, "won"),
        ),
      )
      .limit(1);

    const now = new Date();
    await tx.update(squadMembers).set({ leftAt: now }).where(eq(squadMembers.id, seat.id));
    if (won) {
      await tx.update(bids).set({ status: "refunded" }).where(eq(bids.id, won.id));
    }
    await tx
      .update(tournamentPlayers)
      .set({ status: "available" })
      .where(eq(tournamentPlayers.id, input.tournamentPlayerId));

    const [captain] = await tx
      .select({ id: captaincies.id })
      .from(captaincies)
      .where(
        and(
          eq(captaincies.tournamentTeamId, input.teamId),
          eq(captaincies.personId, seat.personId),
          isNull(captaincies.endedAt),
        ),
      )
      .limit(1);
    if (captain) {
      await tx.update(captaincies).set({ endedAt: now }).where(eq(captaincies.id, captain.id));
    }

    await tx.insert(activityLog).values({
      tournamentId: input.tournamentId,
      actor: "admin",
      action: "squad.remove",
      entityType: "player",
      entityId: input.tournamentPlayerId,
      payload: {
        playerName: seat.name,
        teamName: seat.teamName,
        refundedAmount: won?.amount ?? 0,
        captaincyClosed: Boolean(captain),
      },
    });
  });
}

export async function savePlaceholders(input: {
  tournamentId: string;
  previousTournamentId: string | null;
  minBid: number | null;
  maxBid: number | null;
  bidJump: number | null;
  penalties: { teamId: string; penalty: number | null }[];
}) {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (
      input.previousTournamentId &&
      input.previousTournamentId === input.tournamentId
    ) {
      throw new Error("A tournament cannot point at itself");
    }
    await tx
      .update(tournaments)
      .set({
        previousTournamentId: input.previousTournamentId,
        minBid: input.minBid,
        maxBid: input.maxBid,
        bidJump: input.bidJump,
      })
      .where(eq(tournaments.id, input.tournamentId));

    for (const team of input.penalties) {
      await tx
        .update(tournamentTeams)
        .set({ penalty: team.penalty })
        .where(
          and(
            eq(tournamentTeams.id, team.teamId),
            eq(tournamentTeams.tournamentId, input.tournamentId),
          ),
        );
    }

    await tx.insert(activityLog).values({
      tournamentId: input.tournamentId,
      actor: "admin",
      action: "placeholders.save",
      entityType: "tournament",
      entityId: input.tournamentId,
      payload: {
        minBid: input.minBid,
        maxBid: input.maxBid,
        bidJump: input.bidJump,
        penalties: input.penalties,
      },
    });
  });
}

export async function savePlayerPhoto(input: {
  tournamentId: string;
  personId: string;
  filename: string;
  bytes: Buffer;
}) {
  const db = getDb();
  const [player] = await db
    .select({ id: tournamentPlayers.id })
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, input.tournamentId),
        eq(tournamentPlayers.personId, input.personId),
      ),
    )
    .limit(1);
  if (!player) throw new Error("That person is not in this tournament");
  const photoPath = await saveUpload(
    `photos/${input.personId}/${safeName(input.filename)}`,
    input.bytes,
  );
  await db.update(people).set({ photoPath }).where(eq(people.id, input.personId));
}
