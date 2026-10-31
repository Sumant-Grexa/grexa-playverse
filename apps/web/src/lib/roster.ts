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
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { openNextLot } from "./auction";
import { defaultTeamName } from "./format";
import { CRORE } from "./rules";
import { column, parseCsv } from "./csv";
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
}) {
  const db = getDb();
  const parsed = parseCsv(input.csvText);
  if (parsed.length === 0) throw new Error("The CSV has no people");

  const rows = parsed.map((row, index) => {
    const name = column(row, "name").trim();
    if (!name) throw new Error(`Row ${index + 2} is missing a name`);
    const wants = flag(column(row, "wantsToBeCaptain")) ?? false;
    const formAnswers: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (KNOWN.has(key.toLowerCase())) continue;
      if (value.trim()) formAnswers[key] = value.trim();
    }
    return { name, wants, formAnswers, index };
  });

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

    const existingPeople = await tx.select().from(people);
    const peopleByName = new Map(
      existingPeople.map((person) => [person.name.trim().toLowerCase(), person]),
    );
    const existingPlayers = await tx
      .select()
      .from(tournamentPlayers)
      .where(eq(tournamentPlayers.tournamentId, input.tournamentId));
    const playerByPerson = new Map(existingPlayers.map((player) => [player.personId, player]));

    for (const row of rows) {
      let person = peopleByName.get(row.name.toLowerCase());
      if (!person) {
        const [created] = await tx.insert(people).values({ name: row.name }).returning();
        person = created;
        peopleByName.set(row.name.toLowerCase(), created);
      } else if (person.name !== row.name) {
        await tx.update(people).set({ name: row.name }).where(eq(people.id, person.id));
      }
      const current = playerByPerson.get(person.id);
      if (current) {
        await tx
          .update(tournamentPlayers)
          .set({
            wantsToBeCaptain: row.wants,
            formAnswers: row.formAnswers,
            auctionOrder: row.index,
          })
          .where(eq(tournamentPlayers.id, current.id));
      } else {
        await tx.insert(tournamentPlayers).values({
          tournamentId: input.tournamentId,
          personId: person.id,
          wantsToBeCaptain: row.wants,
          formAnswers: row.formAnswers,
          auctionOrder: row.index,
          status: "available",
        });
      }
    }

    const [state] = await tx
      .select({ tournamentId: auctionState.tournamentId, status: auctionState.status })
      .from(auctionState)
      .where(eq(auctionState.tournamentId, input.tournamentId))
      .limit(1);
    if (!state) {
      await tx.insert(auctionState).values({
        tournamentId: input.tournamentId,
        status: "idle",
      });
      await openNextLot(tx, input.tournamentId);
    } else if (state.status === "idle") {
      await openNextLot(tx, input.tournamentId);
    }

    await tx.insert(activityLog).values({
      tournamentId: input.tournamentId,
      actor: "admin",
      action: "roster.import",
      entityType: "tournament",
      entityId: input.tournamentId,
      payload: { people: rows.length },
    });
  });

  return { people: rows.length };
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
    const [onSquad] = await tx
      .select({ id: squadMembers.id })
      .from(squadMembers)
      .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, squadMembers.tournamentPlayerId))
      .where(
        and(
          eq(tournamentPlayers.personId, input.personId),
          eq(tournamentPlayers.tournamentId, input.tournamentId),
          isNull(squadMembers.leftAt),
        ),
      )
      .limit(1);
    if (onSquad) throw new Error("Remove them from a squad before they captain a team");
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
      await openNextLot(tx, input.tournamentId);
    }

    const [previousPerson] = previous?.personId
      ? await tx.select({ name: people.name }).from(people).where(eq(people.id, previous.personId)).limit(1)
      : [null];
    if (person && previousPerson && team.name === defaultTeamName(previousPerson.name)) {
      const nextName = await uniqueTeamName(tx, input.tournamentId, defaultTeamName(person.name), input.teamId);
      await tx.update(tournamentTeams).set({ name: nextName }).where(eq(tournamentTeams.id, input.teamId));
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

export async function createTeam(input: { tournamentId: string; captainName: string }) {
  const db = getDb();
  const captainName = input.captainName.trim();
  if (!captainName) throw new Error("Enter the captain name");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from tournaments where id = ${input.tournamentId} for update`);
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(eq(tournaments.id, input.tournamentId))
      .limit(1);
    if (!tournament) throw new Error("Tournament not found");
    const person = await ensureNamedPlayer(tx, input.tournamentId, captainName);
    const [busy] = await tx
      .select({ id: captaincies.id })
      .from(captaincies)
      .where(and(eq(captaincies.personId, person.personId), isNull(captaincies.endedAt)))
      .limit(1);
    if (busy) throw new Error(`${captainName} already captains a team`);
    const [last] = await tx
      .select({ sortOrder: tournamentTeams.sortOrder })
      .from(tournamentTeams)
      .where(eq(tournamentTeams.tournamentId, input.tournamentId))
      .orderBy(desc(tournamentTeams.sortOrder))
      .limit(1);
    const name = await uniqueTeamName(tx, input.tournamentId, defaultTeamName(captainName));
    const [team] = await tx
      .insert(tournamentTeams)
      .values({
        tournamentId: input.tournamentId,
        name,
        openingBalance: CRORE,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      })
      .returning();
    await tx.insert(captaincies).values({
      tournamentTeamId: team.id,
      personId: person.personId,
    });
    await tx.insert(activityLog).values({
      tournamentId: input.tournamentId,
      actor: "admin",
      action: "team.create",
      entityType: "team",
      entityId: team.id,
      payload: { teamName: name, captainName },
    });
    const [state] = await tx
      .select({ status: auctionState.status })
      .from(auctionState)
      .where(eq(auctionState.tournamentId, input.tournamentId))
      .limit(1);
    if (!state) {
      await tx.insert(auctionState).values({ tournamentId: input.tournamentId, status: "idle" });
      await openNextLot(tx, input.tournamentId);
    }
    return { teamId: team.id, name };
  });
}

export async function updateTeam(input: {
  tournamentId: string;
  teamId: string;
  name: string;
  logo?: { filename: string; bytes: Buffer };
}) {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error("Name the team");
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
    const nextName = await uniqueTeamName(tx, input.tournamentId, name, input.teamId);
    let logoPath = team.logoPath;
    if (input.logo) {
      logoPath = await saveUpload(
        `logos/${input.teamId}/${safeName(input.logo.filename)}`,
        input.logo.bytes,
      );
    }
    await tx
      .update(tournamentTeams)
      .set({ name: nextName, logoPath })
      .where(eq(tournamentTeams.id, input.teamId));
    await tx.insert(activityLog).values({
      tournamentId: input.tournamentId,
      actor: "admin",
      action: "team.update",
      entityType: "team",
      entityId: input.teamId,
      payload: { teamName: nextName },
    });
  });
}

export async function addSquadMember(input: {
  tournamentId: string;
  teamId: string;
  tournamentPlayerId: string;
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
      .select({
        id: tournamentPlayers.id,
        status: tournamentPlayers.status,
        personId: tournamentPlayers.personId,
        name: people.name,
      })
      .from(tournamentPlayers)
      .innerJoin(people, eq(people.id, tournamentPlayers.personId))
      .where(
        and(
          eq(tournamentPlayers.id, input.tournamentPlayerId),
          eq(tournamentPlayers.tournamentId, input.tournamentId),
        ),
      )
      .limit(1);
    if (!player) throw new Error("That person is not in this tournament");
    if (player.status !== "available") throw new Error(`${player.name} is not available`);
    const [captain] = await tx
      .select({ id: captaincies.id })
      .from(captaincies)
      .where(and(eq(captaincies.personId, player.personId), isNull(captaincies.endedAt)))
      .limit(1);
    if (captain) throw new Error("A captain cannot join a squad");
    await tx.insert(squadMembers).values({
      tournamentTeamId: input.teamId,
      tournamentPlayerId: player.id,
    });
    await tx.update(tournamentPlayers).set({ status: "sold" }).where(eq(tournamentPlayers.id, player.id));
    await tx.insert(bids).values({
      tournamentId: input.tournamentId,
      tournamentPlayerId: player.id,
      tournamentTeamId: input.teamId,
      amount: 0,
      status: "won",
    });
    await tx.insert(activityLog).values({
      tournamentId: input.tournamentId,
      actor: "admin",
      action: "squad.add",
      entityType: "player",
      entityId: player.id,
      payload: { playerName: player.name, teamName: team.name },
    });
  });
}

async function ensureNamedPlayer(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  tournamentId: string,
  name: string,
) {
  const existingPeople = await tx.select().from(people);
  let person = existingPeople.find((item) => item.name.trim().toLowerCase() === name.toLowerCase());
  if (!person) {
    const [created] = await tx.insert(people).values({ name }).returning();
    person = created;
  }
  const [player] = await tx
    .select()
    .from(tournamentPlayers)
    .where(
      and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.personId, person.id)),
    )
    .limit(1);
  if (!player) {
    await tx.insert(tournamentPlayers).values({
      tournamentId,
      personId: person.id,
      wantsToBeCaptain: true,
      formAnswers: {},
      auctionOrder: 10_000,
      status: "available",
    });
  }
  return { personId: person.id };
}

async function uniqueTeamName(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  tournamentId: string,
  desired: string,
  exceptTeamId?: string,
) {
  const rows = await tx
    .select({ id: tournamentTeams.id, name: tournamentTeams.name })
    .from(tournamentTeams)
    .where(eq(tournamentTeams.tournamentId, tournamentId));
  const taken = new Set(
    rows
      .filter((row) => row.id !== exceptTeamId)
      .map((row) => row.name.trim().toLowerCase()),
  );
  if (!taken.has(desired.toLowerCase())) return desired;
  let n = 2;
  while (taken.has(`${desired} ${n}`.toLowerCase())) n += 1;
  return `${desired} ${n}`;
}
