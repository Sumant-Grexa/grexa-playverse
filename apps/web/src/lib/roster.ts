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
import { CRORE, openingPurse } from "./rules";
import { column, parseCsv } from "./csv";
import { safeName, saveUpload } from "./uploads";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

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

  const photos = await importDrivePhotos(input.tournamentId);
  return { people: rows.length, photos };
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

export async function updatePlayerPrice(input: {
  tournamentId: string;
  teamId: string;
  tournamentPlayerId: string;
  amount: number;
}) {
  if (!Number.isInteger(input.amount) || input.amount < 0) {
    throw new Error("Enter the price as a whole number");
  }
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from tournaments where id = ${input.tournamentId} for update`);
    const [team] = await tx
      .select()
      .from(tournamentTeams)
      .where(and(eq(tournamentTeams.id, input.teamId), eq(tournamentTeams.tournamentId, input.tournamentId)))
      .limit(1);
    if (!team) throw new Error("Team not found");
    const [seat] = await tx
      .select({ id: squadMembers.id, name: people.name })
      .from(squadMembers)
      .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, squadMembers.tournamentPlayerId))
      .innerJoin(people, eq(people.id, tournamentPlayers.personId))
      .where(
        and(
          eq(squadMembers.tournamentTeamId, input.teamId),
          eq(squadMembers.tournamentPlayerId, input.tournamentPlayerId),
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

    const [spentRow] = await tx
      .select({ spent: sql<number>`coalesce(sum(${bids.amount}), 0)::int` })
      .from(bids)
      .where(and(eq(bids.tournamentTeamId, input.teamId), eq(bids.status, "won")));
    const spentAfter = Number(spentRow?.spent ?? 0) - (won?.amount ?? 0) + input.amount;
    if (spentAfter > openingPurse(team.openingBalance)) {
      throw new Error(`${team.name} cannot afford that price`);
    }

    if (won) {
      await tx.update(bids).set({ amount: input.amount }).where(eq(bids.id, won.id));
    } else {
      await tx.insert(bids).values({
        tournamentId: input.tournamentId,
        tournamentPlayerId: input.tournamentPlayerId,
        tournamentTeamId: input.teamId,
        amount: input.amount,
        status: "won",
      });
    }

    await tx.insert(activityLog).values({
      tournamentId: input.tournamentId,
      actor: "admin",
      action: "squad.price",
      entityType: "player",
      entityId: input.tournamentPlayerId,
      payload: {
        playerName: seat.name,
        teamName: team.name,
        fromAmount: won?.amount ?? 0,
        toAmount: input.amount,
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

export type CaptainFacts = { gender?: string; department?: string };

/** Write the captain's gender/department into their form answers so squad checks count them. */
async function saveCaptainFacts(tx: Tx, tournamentId: string, personId: string, facts: CaptainFacts) {
  const gender = facts.gender?.trim() ?? "";
  const department = facts.department?.trim() ?? "";
  if (!gender && !department) return;
  const [player] = await tx
    .select({ id: tournamentPlayers.id, formAnswers: tournamentPlayers.formAnswers })
    .from(tournamentPlayers)
    .where(and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.personId, personId)))
    .limit(1);
  if (!player) return;
  const answers = { ...(player.formAnswers ?? {}) };
  const put = (pattern: RegExp, fallbackKey: string, value: string) => {
    if (!value) return;
    const key = Object.keys(answers).find((item) => pattern.test(item)) ?? fallbackKey;
    answers[key] = value;
  };
  put(/gender/i, "gender", gender);
  put(/department/i, "department", department);
  await tx.update(tournamentPlayers).set({ formAnswers: answers }).where(eq(tournamentPlayers.id, player.id));
}

export async function createTeam(input: {
  tournamentId: string;
  captainName: string;
  photo?: { filename: string; bytes: Buffer };
  captain: CaptainFacts;
}) {
  const db = getDb();
  const captainName = input.captainName.trim();
  if (!captainName) throw new Error("Enter the captain name");
  if (!input.captain.gender?.trim()) throw new Error("Choose the captain's gender");
  if (!input.captain.department?.trim()) throw new Error("Enter the captain's department");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from tournaments where id = ${input.tournamentId} for update`);
    const [tournament] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(eq(tournaments.id, input.tournamentId))
      .limit(1);
    if (!tournament) throw new Error("Tournament not found");
    const person = await ensureNamedPlayer(tx, input.tournamentId, captainName);
    if (input.photo) {
      const photoPath = await saveUpload(
        `photos/${person.personId}/${safeName(input.photo.filename)}`,
        input.photo.bytes,
      );
      await tx.update(people).set({ photoPath }).where(eq(people.id, person.personId));
    }
    const [busy] = await tx
      .select({ id: captaincies.id })
      .from(captaincies)
      .where(and(eq(captaincies.personId, person.personId), isNull(captaincies.endedAt)))
      .limit(1);
    if (busy) throw new Error(`${captainName} already captains a team`);
    await saveCaptainFacts(tx, input.tournamentId, person.personId, input.captain);
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
  captainPhoto?: { filename: string; bytes: Buffer };
  captain?: CaptainFacts;
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
    if (input.captain) {
      const [current] = await tx
        .select({ personId: captaincies.personId })
        .from(captaincies)
        .where(and(eq(captaincies.tournamentTeamId, input.teamId), isNull(captaincies.endedAt)))
        .limit(1);
      if (current) await saveCaptainFacts(tx, input.tournamentId, current.personId, input.captain);
    }
    if (input.captainPhoto) {
      const [captain] = await tx
        .select({ personId: captaincies.personId })
        .from(captaincies)
        .where(and(eq(captaincies.tournamentTeamId, input.teamId), isNull(captaincies.endedAt)))
        .limit(1);
      if (!captain) throw new Error("Set a captain before saving their photo");
      const photoPath = await saveUpload(
        `photos/${captain.personId}/${safeName(input.captainPhoto.filename)}`,
        input.captainPhoto.bytes,
      );
      await tx.update(people).set({ photoPath }).where(eq(people.id, captain.personId));
    }
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
    if (player.status !== "available" && player.status !== "unsold") {
      throw new Error(`${player.name} is not available`);
    }
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

const PHOTO_ANSWER = /photo|picture|image|selfie/i;
const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function driveFileId(link: string) {
  const match = link.match(/[?&]id=([\w-]{10,})/) ?? link.match(/\/d\/([\w-]{10,})/);
  return match?.[1] ?? null;
}

async function downloadDriveImage(fileId: string) {
  // The thumbnail endpoint returns JPEG/PNG even for HEIC uploads; the download URL is the fallback.
  const urls = [
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`,
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
      const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
      const ext = MIME_EXT[type];
      if (response.ok && ext) return { ext, bytes: Buffer.from(await response.arrayBuffer()) };
    } catch {
      // try the next URL
    }
  }
  return null;
}

/**
 * Copy each player's Google Drive photo (from the form's photo column) into local uploads.
 * Skips photos uploaded by hand and Drive photos already copied for the same file.
 */
async function importDrivePhotos(tournamentId: string) {
  const db = getDb();
  const rows = await db
    .select({
      personId: people.id,
      name: people.name,
      photoPath: people.photoPath,
      formAnswers: tournamentPlayers.formAnswers,
    })
    .from(tournamentPlayers)
    .innerJoin(people, eq(people.id, tournamentPlayers.personId))
    .where(eq(tournamentPlayers.tournamentId, tournamentId));

  const queue = rows.flatMap((row) => {
    const answers = row.formAnswers ?? {};
    const key = Object.keys(answers).find((item) => PHOTO_ANSWER.test(item));
    const fileId = key ? driveFileId(answers[key] ?? "") : null;
    if (!fileId) return [];
    const manual = row.photoPath && !row.photoPath.includes("/drive-");
    const copied = row.photoPath?.includes(`/drive-${fileId}.`);
    return manual || copied ? [] : [{ ...row, fileId }];
  });

  let saved = 0;
  const failed: string[] = [];
  async function work() {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const image = await downloadDriveImage(row.fileId);
      if (!image) {
        failed.push(row.name);
        continue;
      }
      const photoPath = await saveUpload(`photos/${row.personId}/drive-${row.fileId}${image.ext}`, image.bytes);
      await db.update(people).set({ photoPath }).where(eq(people.id, row.personId));
      saved += 1;
    }
  }
  await Promise.all(Array.from({ length: 6 }, work));
  return { saved, failed };
}
