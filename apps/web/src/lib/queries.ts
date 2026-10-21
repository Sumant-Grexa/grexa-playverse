import "server-only";

import {
  activityLog,
  auctionState,
  bids,
  browniePoints,
  captaincies,
  gameStandings,
  games,
  getDb,
  people,
  squadMembers,
  tournamentPlayers,
  tournamentTeams,
  tournaments,
} from "@playverse/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { mediaUrl } from "./uploads";
import type { LeaderboardPayload, LivePayload, TournamentDesk, TournamentSummary } from "./types";

type Database = ReturnType<typeof getDb>;

export async function listTournaments() {
  const db = getDb();
  const rows = await db.select().from(tournaments).orderBy(desc(tournaments.createdAt));
  return rows.map(toSummary);
}

export async function getTournament(id: string) {
  const db = getDb();
  const [row] = await db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1);
  return row ?? null;
}

export async function getActiveTournament() {
  const db = getDb();
  const [row] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.status, "active"))
    .orderBy(desc(tournaments.createdAt))
    .limit(1);
  return row ?? null;
}

function toSummary(row: {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
}): TournamentSummary {
  return { id: row.id, name: row.name, status: row.status };
}

export async function getLive(): Promise<LivePayload> {
  const tournament = await getActiveTournament();
  if (!tournament) {
    return {
      tournament: null,
      state: { status: "idle", currentAmount: null, currentTeamName: null },
      waiting: 0,
      player: null,
      tape: [],
      teams: [],
    };
  }
  const db = getDb();
  return buildLive(db, tournament);
}

async function buildLive(
  db: Database,
  tournament: NonNullable<Awaited<ReturnType<typeof getActiveTournament>>>,
): Promise<LivePayload> {
  const [state] = await db
    .select()
    .from(auctionState)
    .where(eq(auctionState.tournamentId, tournament.id))
    .limit(1);

  const teams = await db
    .select()
    .from(tournamentTeams)
    .where(eq(tournamentTeams.tournamentId, tournament.id))
    .orderBy(asc(tournamentTeams.sortOrder), asc(tournamentTeams.name));

  const openCaptains = await db
    .select({
      teamId: captaincies.tournamentTeamId,
      personId: captaincies.personId,
      name: people.name,
    })
    .from(captaincies)
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, captaincies.tournamentTeamId))
    .innerJoin(people, eq(people.id, captaincies.personId))
    .where(and(eq(tournamentTeams.tournamentId, tournament.id), isNull(captaincies.endedAt)));

  const captainByTeam = new Map(openCaptains.map((row) => [row.teamId, row]));
  const captainPersonIds = new Set(openCaptains.map((row) => row.personId));

  const spentRows = await db
    .select({
      teamId: bids.tournamentTeamId,
      spent: sql<number>`coalesce(sum(${bids.amount}), 0)::int`,
    })
    .from(bids)
    .where(and(eq(bids.tournamentId, tournament.id), eq(bids.status, "won")))
    .groupBy(bids.tournamentTeamId);
  const spentByTeam = new Map(spentRows.map((row) => [row.teamId, Number(row.spent)]));

  const squadRows = await db
    .select({ teamId: squadMembers.tournamentTeamId })
    .from(squadMembers)
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, squadMembers.tournamentTeamId))
    .where(and(eq(tournamentTeams.tournamentId, tournament.id), isNull(squadMembers.leftAt)));
  const squadCount = new Map<string, number>();
  for (const row of squadRows) {
    squadCount.set(row.teamId, (squadCount.get(row.teamId) ?? 0) + 1);
  }

  const waitingRows = await db
    .select({ personId: tournamentPlayers.personId })
    .from(tournamentPlayers)
    .where(
      and(eq(tournamentPlayers.tournamentId, tournament.id), eq(tournamentPlayers.status, "available")),
    );
  const waiting = waitingRows.filter((row) => !captainPersonIds.has(row.personId)).length;

  let player: LivePayload["player"] = null;
  let tape: LivePayload["tape"] = [];
  if (state?.tournamentPlayerId) {
    const [lot] = await db
      .select({
        personId: people.id,
        name: people.name,
        photoPath: people.photoPath,
        formAnswers: tournamentPlayers.formAnswers,
      })
      .from(tournamentPlayers)
      .innerJoin(people, eq(people.id, tournamentPlayers.personId))
      .where(eq(tournamentPlayers.id, state.tournamentPlayerId))
      .limit(1);

    if (lot) {
      const captainTeam = openCaptains.find((row) => row.personId === lot.personId);
      player = {
        name: lot.name,
        photoUrl: mediaUrl(lot.photoPath),
        formAnswers: lot.formAnswers ?? {},
        captainOf: captainTeam
          ? (teams.find((team) => team.id === captainTeam.teamId)?.name ?? null)
          : null,
        lastSeason: await lastSeasonSale(db, tournament.previousTournamentId, lot.personId),
      };

      const bidRows = await db
        .select({
          id: bids.id,
          amount: bids.amount,
          teamName: tournamentTeams.name,
          logoPath: tournamentTeams.logoPath,
          createdAt: bids.createdAt,
        })
        .from(bids)
        .innerJoin(tournamentTeams, eq(tournamentTeams.id, bids.tournamentTeamId))
        .where(
          and(
            eq(bids.tournamentPlayerId, state.tournamentPlayerId),
            eq(bids.status, "placed"),
          ),
        )
        .orderBy(desc(bids.createdAt));
      tape = bidRows.map((row) => ({
        id: row.id,
        teamName: row.teamName,
        logoUrl: mediaUrl(row.logoPath),
        amount: row.amount,
      }));
    }
  }

  const currentTeam = teams.find((team) => team.id === state?.currentTeamId);

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      minBid: tournament.minBid,
      maxBid: tournament.maxBid,
      bidJump: tournament.bidJump,
    },
    state: {
      status: state?.status ?? "idle",
      currentAmount: state?.currentAmount ?? null,
      currentTeamName: currentTeam?.name ?? null,
    },
    waiting,
    player,
    tape,
    teams: teams.map((team) => {
      const spent = spentByTeam.get(team.id) ?? 0;
      return {
        id: team.id,
        name: team.name,
        logoUrl: mediaUrl(team.logoPath),
        balance: team.openingBalance == null ? null : team.openingBalance - spent,
        captainName: captainByTeam.get(team.id)?.name ?? null,
        squadCount: squadCount.get(team.id) ?? 0,
      };
    }),
  };
}

async function lastSeasonSale(db: Database, previousTournamentId: string | null, personId: string) {
  if (!previousTournamentId) return null;
  const [row] = await db
    .select({
      amount: bids.amount,
      status: bids.status,
      teamName: tournamentTeams.name,
    })
    .from(bids)
    .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, bids.tournamentPlayerId))
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, bids.tournamentTeamId))
    .where(
      and(
        eq(tournamentPlayers.tournamentId, previousTournamentId),
        eq(tournamentPlayers.personId, personId),
        inArray(bids.status, ["won", "refunded"]),
      ),
    )
    .orderBy(desc(bids.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    teamName: row.teamName,
    amount: row.amount,
    refunded: row.status === "refunded",
  };
}

export async function getLeaderboard(): Promise<LeaderboardPayload> {
  const tournament = await getActiveTournament();
  if (!tournament) {
    return { tournament: null, scale: 1, totals: [], games: [] };
  }
  const db = getDb();
  const teamRows = await db
    .select()
    .from(tournamentTeams)
    .where(eq(tournamentTeams.tournamentId, tournament.id))
    .orderBy(asc(tournamentTeams.sortOrder));
  const gameRows = await db
    .select()
    .from(games)
    .where(eq(games.tournamentId, tournament.id))
    .orderBy(desc(games.startedOn));
  const gameIds = gameRows.map((game) => game.id);
  const standingRows = gameIds.length
    ? await db.select().from(gameStandings).where(inArray(gameStandings.gameId, gameIds))
    : [];
  const standingIds = standingRows.map((row) => row.id);
  const brownieRows = standingIds.length
    ? await db.select().from(browniePoints).where(inArray(browniePoints.gameStandingId, standingIds))
    : [];

  const browniesByStanding = new Map<string, { id: string; name: string; value: number }[]>();
  for (const brownie of brownieRows) {
    const list = browniesByStanding.get(brownie.gameStandingId) ?? [];
    list.push({ id: brownie.id, name: brownie.name, value: brownie.value });
    browniesByStanding.set(brownie.gameStandingId, list);
  }

  const teamById = new Map(teamRows.map((team) => [team.id, team]));
  const totals = new Map<string, number>(teamRows.map((team) => [team.id, 0]));

  const gamePayload = gameRows.map((game) => {
    const rows = standingRows
      .filter((standing) => standing.gameId === game.id)
      .map((standing) => {
        const team = teamById.get(standing.tournamentTeamId);
        const brownies = browniesByStanding.get(standing.id) ?? [];
        const total = standing.score + brownies.reduce((sum, brownie) => sum + brownie.value, 0);
        totals.set(standing.tournamentTeamId, (totals.get(standing.tournamentTeamId) ?? 0) + total);
        return {
          standingId: standing.id,
          teamId: standing.tournamentTeamId,
          teamName: team?.name ?? "Team",
          logoUrl: mediaUrl(team?.logoPath),
          score: standing.score,
          brownies,
          total,
        };
      })
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
    return {
      id: game.id,
      name: game.name,
      startedOn: game.startedOn.toISOString(),
      endedOn: game.endedOn?.toISOString() ?? null,
      maxScore: game.maxScore,
      rows,
    };
  });

  const maxTotal = Math.max(0, ...totals.values());
  const maxScoreSum = gameRows.reduce((sum, game) => sum + game.maxScore, 0);

  return {
    tournament: { id: tournament.id, name: tournament.name },
    scale: Math.max(maxScoreSum, maxTotal, 1),
    totals: teamRows.map((team) => ({
      teamId: team.id,
      teamName: team.name,
      logoUrl: mediaUrl(team.logoPath),
      total: totals.get(team.id) ?? 0,
    })),
    games: gamePayload,
  };
}

export async function getTournamentDesk(selectedId?: string): Promise<TournamentDesk> {
  const db = getDb();
  const all = await listTournaments();
  const active = all.find((item) => item.status === "active");
  const selected = all.find((item) => item.id === selectedId) ?? active ?? all[0] ?? null;
  if (!selected) return { tournaments: [], selected: null };

  const tournament = await getTournament(selected.id);
  if (!tournament) return { tournaments: all, selected: null };

  const teams = await db
    .select()
    .from(tournamentTeams)
    .where(eq(tournamentTeams.tournamentId, tournament.id))
    .orderBy(asc(tournamentTeams.sortOrder), asc(tournamentTeams.name));

  const captains = await db
    .select({
      teamId: captaincies.tournamentTeamId,
      personId: people.id,
      name: people.name,
    })
    .from(captaincies)
    .innerJoin(people, eq(people.id, captaincies.personId))
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, captaincies.tournamentTeamId))
    .where(and(eq(tournamentTeams.tournamentId, tournament.id), isNull(captaincies.endedAt)));

  const squad = await db
    .select({
      teamId: squadMembers.tournamentTeamId,
      tournamentPlayerId: squadMembers.tournamentPlayerId,
      name: people.name,
    })
    .from(squadMembers)
    .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, squadMembers.tournamentPlayerId))
    .innerJoin(people, eq(people.id, tournamentPlayers.personId))
    .where(and(eq(tournamentPlayers.tournamentId, tournament.id), isNull(squadMembers.leftAt)));

  const wonBids = await db
    .select({
      tournamentPlayerId: bids.tournamentPlayerId,
      teamId: bids.tournamentTeamId,
      amount: bids.amount,
    })
    .from(bids)
    .where(and(eq(bids.tournamentId, tournament.id), eq(bids.status, "won")));

  const spentRows = await db
    .select({
      teamId: bids.tournamentTeamId,
      spent: sql<number>`coalesce(sum(${bids.amount}), 0)::int`,
    })
    .from(bids)
    .where(and(eq(bids.tournamentId, tournament.id), eq(bids.status, "won")))
    .groupBy(bids.tournamentTeamId);
  const spentByTeam = new Map(spentRows.map((row) => [row.teamId, Number(row.spent)]));

  const playerRows = await db
    .select({
      tournamentPlayerId: tournamentPlayers.id,
      personId: people.id,
      name: people.name,
      photoPath: people.photoPath,
      status: tournamentPlayers.status,
      wantsToBeCaptain: tournamentPlayers.wantsToBeCaptain,
    })
    .from(tournamentPlayers)
    .innerJoin(people, eq(people.id, tournamentPlayers.personId))
    .where(eq(tournamentPlayers.tournamentId, tournament.id))
    .orderBy(asc(tournamentPlayers.auctionOrder), asc(people.name));

  const captainPersonIds = new Set(captains.map((captain) => captain.personId));
  const activity = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.tournamentId, tournament.id))
    .orderBy(desc(activityLog.createdAt))
    .limit(40);

  return {
    tournaments: all,
    selected: {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      previousTournamentId: tournament.previousTournamentId,
      minBid: tournament.minBid,
      maxBid: tournament.maxBid,
      bidJump: tournament.bidJump,
      teams: teams.map((team) => {
        const captain = captains.find((item) => item.teamId === team.id);
        const spent = spentByTeam.get(team.id) ?? 0;
        return {
          id: team.id,
          name: team.name,
          logoUrl: mediaUrl(team.logoPath),
          openingBalance: team.openingBalance,
          balance: team.openingBalance == null ? null : team.openingBalance - spent,
          penalty: team.penalty,
          captainPersonId: captain?.personId ?? null,
          captainName: captain?.name ?? null,
          squad: squad
            .filter((member) => member.teamId === team.id)
            .map((member) => ({
              tournamentPlayerId: member.tournamentPlayerId,
              name: member.name,
              refundAmount:
                wonBids.find(
                  (bid) =>
                    bid.tournamentPlayerId === member.tournamentPlayerId && bid.teamId === team.id,
                )?.amount ?? 0,
            })),
        };
      }),
      players: playerRows.map((player) => ({
        tournamentPlayerId: player.tournamentPlayerId,
        personId: player.personId,
        name: player.name,
        photoUrl: mediaUrl(player.photoPath),
        status: player.status,
        wantsToBeCaptain: player.wantsToBeCaptain,
        isCaptain: captainPersonIds.has(player.personId),
      })),
      activity: activity.map((entry) => ({
        id: entry.id,
        action: entry.action,
        createdAt: entry.createdAt.toISOString(),
        payload: entry.payload ?? {},
      })),
    },
  };
}
