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
import { bidGate, bidProblem, CRORE, memberFact, openingPurse, overDepartmentCap, seatPlan, teamSeats } from "./rules";
import { auctionPool } from "./pool";

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

async function teamSnapshot(tx: Tx, tournamentId: string, teamId: string, incomingPlayerId: string) {
  const [team] = await tx.select().from(tournamentTeams).where(eq(tournamentTeams.id, teamId)).limit(1);
  const [spentRow] = await tx
    .select({ spent: sql<number>`coalesce(sum(${bids.amount}), 0)::int` })
    .from(bids)
    .where(and(eq(bids.tournamentTeamId, teamId), eq(bids.status, "won")));
  const squad = await tx
    .select({ formAnswers: tournamentPlayers.formAnswers })
    .from(squadMembers)
    .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, squadMembers.tournamentPlayerId))
    .where(and(eq(squadMembers.tournamentTeamId, teamId), isNull(squadMembers.leftAt)));
  const [captain] = await tx
    .select({ name: people.name, formAnswers: tournamentPlayers.formAnswers })
    .from(captaincies)
    .innerJoin(people, eq(people.id, captaincies.personId))
    .leftJoin(
      tournamentPlayers,
      and(eq(tournamentPlayers.personId, captaincies.personId), eq(tournamentPlayers.tournamentId, tournamentId)),
    )
    .where(and(eq(captaincies.tournamentTeamId, teamId), isNull(captaincies.endedAt)))
    .limit(1);
  const [incoming] = await tx
    .select({ formAnswers: tournamentPlayers.formAnswers })
    .from(tournamentPlayers)
    .where(eq(tournamentPlayers.id, incomingPlayerId))
    .limit(1);
  const [poolRow] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentPlayers)
    .where(auctionPool(tournamentId));
  const teamRows = await tx
    .select({ id: tournamentTeams.id })
    .from(tournamentTeams)
    .where(eq(tournamentTeams.tournamentId, tournamentId));
  const squadRows = await tx
    .select({ teamId: squadMembers.tournamentTeamId, count: sql<number>`count(*)::int` })
    .from(squadMembers)
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, squadMembers.tournamentTeamId))
    .where(and(eq(tournamentTeams.tournamentId, tournamentId), isNull(squadMembers.leftAt)))
    .groupBy(squadMembers.tournamentTeamId);
  const plan = seatPlan(Number(poolRow?.count ?? 0), teamRows.length);
  const countByTeam = new Map(squadRows.map((row) => [row.teamId, Number(row.count)]));
  const seats = teamSeats(
    plan,
    squad.length,
    teamRows.filter((row) => row.id !== teamId).map((row) => countByTeam.get(row.id) ?? 0),
  );
  return {
    balance: openingPurse(team?.openingBalance) - Number(spentRow?.spent ?? 0),
    squadCount: squad.length,
    seats: plan.base,
    cap: seats.cap,
    members: [
      ...(captain ? [memberFact(captain.formAnswers)] : []),
      ...squad.map((member) => memberFact(member.formAnswers)),
    ],
    incoming: memberFact(incoming?.formAnswers),
    captainName: captain?.name ?? "No captain",
  };
}

async function captainPersonIds(tx: Tx, tournamentId: string) {
  const rows = await tx
    .select({ personId: captaincies.personId })
    .from(captaincies)
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, captaincies.tournamentTeamId))
    .where(and(eq(tournamentTeams.tournamentId, tournamentId), isNull(captaincies.endedAt)));
  return new Set(rows.map((row) => row.personId));
}

export async function openNextLot(tx: Tx, tournamentId: string) {
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

export async function placeBid(teamId: string, amount: number) {
  const db = getDb();
  // A rule-rejected bid is logged and committed so the public board shows it, then thrown.
  const rejected = await db.transaction(async (tx): Promise<string | null> => {
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
    const problem = bidProblem(amount, state.currentAmount);
    if (problem) throw new Error(problem);

    const snapshot = await teamSnapshot(tx, tournament.id, team.id, state.tournamentPlayerId);
    const gate = bidGate({
      amount,
      balance: snapshot.balance,
      squadCount: snapshot.squadCount,
      seats: snapshot.seats,
      cap: snapshot.cap,
      members: snapshot.members,
      incoming: snapshot.incoming,
    });
    const overPurse = amount > snapshot.balance;
    if (gate.kind !== "ok") {
      const message =
        gate.kind === "stop" ? `${snapshot.captainName}: ${gate.reason}` : gate.message;
      await tx.insert(activityLog).values({
        tournamentId: tournament.id,
        actor: "admin",
        action: "auction.blocked",
        entityType: "team",
        entityId: team.id,
        payload: {
          teamId: team.id,
          captainName: snapshot.captainName,
          amount,
          message,
          womenFail: gate.kind === "buzz" && gate.womenFail,
          crossFail: gate.kind === "buzz" && gate.crossFail,
        },
      });
      return message;
    }

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
      action: overPurse ? "auction.overpurse" : "auction.bid",
      entityType: "team",
      entityId: team.id,
      payload: {
        teamName: team.name,
        captainName: snapshot.captainName,
        amount,
        remaining: snapshot.balance,
      },
    });
    return null;
  });
  if (rejected) {
    const blocked = new Error(rejected);
    blocked.name = "AuctionBuzzError";
    throw blocked;
  }
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

    const [incoming] = await tx
      .select({ formAnswers: tournamentPlayers.formAnswers })
      .from(tournamentPlayers)
      .where(eq(tournamentPlayers.id, state.tournamentPlayerId))
      .limit(1);
    const onTeam = await tx
      .select({ formAnswers: tournamentPlayers.formAnswers })
      .from(squadMembers)
      .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, squadMembers.tournamentPlayerId))
      .where(and(eq(squadMembers.tournamentTeamId, high.tournamentTeamId), isNull(squadMembers.leftAt)));
    const [captain] = await tx
      .select({ formAnswers: tournamentPlayers.formAnswers })
      .from(captaincies)
      .innerJoin(
        tournamentPlayers,
        and(
          eq(tournamentPlayers.personId, captaincies.personId),
          eq(tournamentPlayers.tournamentId, tournament.id),
        ),
      )
      .where(and(eq(captaincies.tournamentTeamId, high.tournamentTeamId), isNull(captaincies.endedAt)))
      .limit(1);
    const cap = overDepartmentCap(
      [...onTeam, captain].flatMap((member) => {
        const department = member ? memberFact(member.formAnswers).department : "";
        return department ? [department] : [];
      }),
      memberFact(incoming?.formAnswers).department,
    );
    if (cap) throw new Error(cap);

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
    await openNextLot(tx, tournament.id);
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
    await openNextLot(tx, tournament.id);
  });
}

export async function resetTestAuction() {
  const db = getDb();
  return db.transaction(async (tx) => {
    const tournament = await requireActive(tx);
    await tx.execute(sql`
      delete from brownie_points
      where game_standing_id in (
        select game_standings.id
        from game_standings
        join games on games.id = game_standings.game_id
        where games.tournament_id = ${tournament.id}
      )
    `);
    await tx.execute(sql`
      delete from game_standings
      where game_id in (select id from games where tournament_id = ${tournament.id})
    `);
    await tx.execute(sql`delete from games where tournament_id = ${tournament.id}`);
    await tx.execute(sql`delete from bids where tournament_id = ${tournament.id}`);
    await tx.execute(sql`
      delete from squad_members
      where tournament_team_id in (
        select id from tournament_teams where tournament_id = ${tournament.id}
      )
    `);
    await tx
      .update(tournamentPlayers)
      .set({ status: "available" })
      .where(eq(tournamentPlayers.tournamentId, tournament.id));
    await tx
      .update(tournamentTeams)
      .set({ openingBalance: CRORE })
      .where(eq(tournamentTeams.tournamentId, tournament.id));
    const playerName = await openNextLot(tx, tournament.id);
    await tx.insert(activityLog).values({
      tournamentId: tournament.id,
      actor: "admin",
      action: "auction.reset",
      entityType: "tournament",
      entityId: tournament.id,
      payload: { playerName },
    });
    return playerName;
  });
}
