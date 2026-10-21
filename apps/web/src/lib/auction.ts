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
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function requireActive(tx: Tx) {
  const [tournament] = await tx
    .select()
    .from(tournaments)
    .where(eq(tournaments.status, "active"))
    .orderBy(desc(tournaments.createdAt))
    .limit(1);
  if (!tournament) throw new Error("There is no live tournament");
  await tx.execute(sql`select id from tournaments where id = ${tournament.id} for update`);
  return tournament;
}

async function captainPersonIds(tx: Tx, tournamentId: string) {
  const rows = await tx
    .select({ personId: captaincies.personId })
    .from(captaincies)
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, captaincies.tournamentTeamId))
    .where(and(eq(tournamentTeams.tournamentId, tournamentId), isNull(captaincies.endedAt)));
  return new Set(rows.map((row) => row.personId));
}

async function advance(tx: Tx, tournamentId: string) {
  const captains = await captainPersonIds(tx, tournamentId);
  const available = await tx
    .select({
      id: tournamentPlayers.id,
      personId: tournamentPlayers.personId,
      name: people.name,
    })
    .from(tournamentPlayers)
    .innerJoin(people, eq(people.id, tournamentPlayers.personId))
    .where(
      and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.status, "available")),
    )
    .orderBy(asc(tournamentPlayers.auctionOrder));
  const next = available.find((player) => !captains.has(player.personId));
  const now = new Date();
  const nextState = {
    status: next ? ("open" as const) : ("idle" as const),
    tournamentPlayerId: next?.id ?? null,
    currentAmount: null,
    currentTeamId: null,
    updatedAt: now,
  };
  if (next) {
    await tx
      .update(tournamentPlayers)
      .set({ status: "on_block" })
      .where(eq(tournamentPlayers.id, next.id));
  }
  const [existing] = await tx
    .select({ tournamentId: auctionState.tournamentId })
    .from(auctionState)
    .where(eq(auctionState.tournamentId, tournamentId))
    .limit(1);
  if (existing) {
    await tx.update(auctionState).set(nextState).where(eq(auctionState.tournamentId, tournamentId));
  } else {
    await tx.insert(auctionState).values({ tournamentId, ...nextState });
  }
  return next?.name ?? null;
}

export async function bringNextPlayer() {
  const db = getDb();
  return db.transaction(async (tx) => {
    const tournament = await requireActive(tx);
    const [state] = await tx
      .select()
      .from(auctionState)
      .where(eq(auctionState.tournamentId, tournament.id))
      .limit(1);
    if (state?.status === "open") {
      throw new Error("Finish the player on the block with Final or Unsold");
    }
    const name = await advance(tx, tournament.id);
    await tx.insert(activityLog).values({
      tournamentId: tournament.id,
      actor: "admin",
      action: "auction.next",
      entityType: "auction",
      entityId: tournament.id,
      payload: { playerName: name },
    });
    return name;
  });
}

export async function placeBid(teamId: string, amount: number) {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("Enter the bid as a whole number");
  }
  const db = getDb();
  await db.transaction(async (tx) => {
    const tournament = await requireActive(tx);
    const [state] = await tx
      .select()
      .from(auctionState)
      .where(eq(auctionState.tournamentId, tournament.id))
      .limit(1);
    if (!state || state.status !== "open" || !state.tournamentPlayerId) {
      throw new Error("Bring a player to the block before bidding");
    }
    const [team] = await tx
      .select()
      .from(tournamentTeams)
      .where(and(eq(tournamentTeams.id, teamId), eq(tournamentTeams.tournamentId, tournament.id)))
      .limit(1);
    if (!team) throw new Error("That team is not in this tournament");

    await tx.insert(bids).values({
      tournamentId: tournament.id,
      tournamentPlayerId: state.tournamentPlayerId,
      tournamentTeamId: team.id,
      amount,
      status: "placed",
    });
    await tx
      .update(auctionState)
      .set({
        currentAmount: amount,
        currentTeamId: team.id,
        updatedAt: new Date(),
      })
      .where(eq(auctionState.tournamentId, tournament.id));
    await tx.insert(activityLog).values({
      tournamentId: tournament.id,
      actor: "admin",
      action: "auction.bid",
      entityType: "team",
      entityId: team.id,
      payload: { teamName: team.name, amount },
    });
  });
}

export async function finalizeBid() {
  const db = getDb();
  await db.transaction(async (tx) => {
    const tournament = await requireActive(tx);
    const [state] = await tx
      .select()
      .from(auctionState)
      .where(eq(auctionState.tournamentId, tournament.id))
      .limit(1);
    if (!state || state.status !== "open" || !state.tournamentPlayerId) {
      throw new Error("There is no open bid to finalize");
    }
    const placed = await tx
      .select()
      .from(bids)
      .where(
        and(eq(bids.tournamentPlayerId, state.tournamentPlayerId), eq(bids.status, "placed")),
      );
    if (placed.length === 0) throw new Error("No team has bid yet");
    const high = [...placed].sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0];
    if (!high) throw new Error("No team has bid yet");

    await tx.update(bids).set({ status: "won" }).where(eq(bids.id, high.id));
    const others = placed.filter((bid) => bid.id !== high.id).map((bid) => bid.id);
    if (others.length > 0) {
      await tx.execute(
        sql`update bids set status = 'lost' where id in (${sql.join(
          others.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }
    await tx
      .update(tournamentPlayers)
      .set({ status: "sold" })
      .where(eq(tournamentPlayers.id, state.tournamentPlayerId));
    await tx.insert(squadMembers).values({
      tournamentTeamId: high.tournamentTeamId,
      tournamentPlayerId: state.tournamentPlayerId,
    });

    const [player] = await tx
      .select({ name: people.name })
      .from(tournamentPlayers)
      .innerJoin(people, eq(people.id, tournamentPlayers.personId))
      .where(eq(tournamentPlayers.id, state.tournamentPlayerId))
      .limit(1);
    const [team] = await tx
      .select({ name: tournamentTeams.name })
      .from(tournamentTeams)
      .where(eq(tournamentTeams.id, high.tournamentTeamId))
      .limit(1);

    await tx.insert(activityLog).values({
      tournamentId: tournament.id,
      actor: "admin",
      action: "auction.final",
      entityType: "player",
      entityId: state.tournamentPlayerId,
      payload: {
        playerName: player?.name ?? "",
        teamName: team?.name ?? "",
        amount: high.amount,
      },
    });
    await advance(tx, tournament.id);
  });
}

export async function markUnsold() {
  const db = getDb();
  await db.transaction(async (tx) => {
    const tournament = await requireActive(tx);
    const [state] = await tx
      .select()
      .from(auctionState)
      .where(eq(auctionState.tournamentId, tournament.id))
      .limit(1);
    if (!state || state.status !== "open" || !state.tournamentPlayerId) {
      throw new Error("There is no player on the block");
    }
    await tx.execute(
      sql`update bids set status = 'lost' where tournament_player_id = ${state.tournamentPlayerId} and status = 'placed'`,
    );
    await tx
      .update(tournamentPlayers)
      .set({ status: "unsold" })
      .where(eq(tournamentPlayers.id, state.tournamentPlayerId));
    const [player] = await tx
      .select({ name: people.name })
      .from(people)
      .innerJoin(tournamentPlayers, eq(tournamentPlayers.personId, people.id))
      .where(eq(tournamentPlayers.id, state.tournamentPlayerId))
      .limit(1);
    await tx.insert(activityLog).values({
      tournamentId: tournament.id,
      actor: "admin",
      action: "auction.unsold",
      entityType: "player",
      entityId: state.tournamentPlayerId,
      payload: { playerName: player?.name ?? "" },
    });
    await advance(tx, tournament.id);
  });
}
