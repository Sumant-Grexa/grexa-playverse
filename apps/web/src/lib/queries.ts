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
import {
  composition,
  memberFact,
  openingPurse,
  playerBadge,
  playerSkills,
  seatPlan,
  squadChecks,
  squadGap,
  teamSeats,
} from "./rules";
import { isUuid } from "./format";
import { auctionPool } from "./pool";
import { mediaUrl } from "./uploads";
import type {
  LeaderboardPayload,
  LivePayload,
  PublicTeamList,
  TeamDetail,
  TournamentDesk,
  TournamentSummary,
} from "./types";

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
      state: {
        status: "idle",
        currentAmount: null,
        currentTeamId: null,
        currentCaptainName: null,
        overPurse: false,
      },
      waiting: 0,
      notice: null,
      marks: { lastBid: null, topBid: null, saleId: null },
      player: null,
      tape: [],
      teams: [],
      ceremony: null,
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
      photoPath: people.photoPath,
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
    .select({
      teamId: squadMembers.tournamentTeamId,
      formAnswers: tournamentPlayers.formAnswers,
    })
    .from(squadMembers)
    .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, squadMembers.tournamentPlayerId))
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, squadMembers.tournamentTeamId))
    .where(and(eq(tournamentTeams.tournamentId, tournament.id), isNull(squadMembers.leftAt)));
  const squadCount = new Map<string, number>();
  const squadFacts = new Map<string, ReturnType<typeof memberFact>[]>();
  for (const row of squadRows) {
    squadCount.set(row.teamId, (squadCount.get(row.teamId) ?? 0) + 1);
    const list = squadFacts.get(row.teamId) ?? [];
    list.push(memberFact(row.formAnswers));
    squadFacts.set(row.teamId, list);
  }

  const captainPlayerRows = await db
    .select({
      personId: tournamentPlayers.personId,
      formAnswers: tournamentPlayers.formAnswers,
    })
    .from(tournamentPlayers)
    .where(eq(tournamentPlayers.tournamentId, tournament.id));
  const answersByPerson = new Map(captainPlayerRows.map((row) => [row.personId, row.formAnswers]));
  const plan = seatPlan(
    captainPlayerRows.filter((row) => !captainPersonIds.has(row.personId)).length,
    teams.length,
  );

  const blockedRows = await db
    .select({
      id: activityLog.id,
      entityId: activityLog.entityId,
      payload: activityLog.payload,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .where(and(eq(activityLog.tournamentId, tournament.id), eq(activityLog.action, "auction.blocked")))
    .orderBy(desc(activityLog.createdAt))
    .limit(80);

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
        id: tournamentPlayers.id,
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
      const answers = lot.formAnswers ?? {};
      player = {
        id: lot.id,
        name: lot.name,
        photoUrl: mediaUrl(lot.photoPath),
        formAnswers: answers,
        skills: playerSkills(answers),
        badge: playerBadge(answers),
        captainOf: captainTeam
          ? (teams.find((team) => team.id === captainTeam.teamId)?.name ?? null)
          : null,
        lastSeason: await lastSeasonSale(db, tournament.previousTournamentId, lot.personId),
      };

      const bidRows = await db
        .select({
          id: bids.id,
          amount: bids.amount,
          teamId: tournamentTeams.id,
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
      tape = bidRows.map((row) => {
        const captain = captainByTeam.get(row.teamId);
        const team = teams.find((item) => item.id === row.teamId);
        const remaining = openingPurse(team?.openingBalance) - (spentByTeam.get(row.teamId) ?? 0);
        return {
          id: row.id,
          teamId: row.teamId,
          captainName: captain?.name ?? "No captain",
          captainPhotoUrl: mediaUrl(captain?.photoPath),
          amount: row.amount,
          overPurse: row.amount > remaining,
        };
      });
    }
  }

  const currentTeam = teams.find((team) => team.id === state?.currentTeamId);

  const wonRows = await db
    .select({
      id: bids.id,
      amount: bids.amount,
      teamName: tournamentTeams.name,
      playerName: people.name,
      createdAt: bids.createdAt,
    })
    .from(bids)
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, bids.tournamentTeamId))
    .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, bids.tournamentPlayerId))
    .innerJoin(people, eq(people.id, tournamentPlayers.personId))
    .where(and(eq(bids.tournamentId, tournament.id), eq(bids.status, "won")))
    .orderBy(desc(bids.createdAt));
  const lastWon = wonRows[0] ?? null;
  const topWon = wonRows.reduce<(typeof wonRows)[number] | null>((best, row) => {
    if (!best || row.amount > best.amount) return row;
    return best;
  }, null);
  const bidMark = (row: (typeof wonRows)[number] | null) =>
    row ? { teamName: row.teamName, playerName: row.playerName, amount: row.amount } : null;

  const [settled] = await db
    .select({ id: tournamentPlayers.id })
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournament.id),
        inArray(tournamentPlayers.status, ["sold", "unsold"]),
      ),
    )
    .limit(1);
  const auctionOver = (state?.status ?? "idle") === "idle" && waiting === 0 && Boolean(settled);

  let ceremony: LivePayload["ceremony"] = null;
  if (auctionOver) {
    const memberRows = await db
      .select({
        teamId: squadMembers.tournamentTeamId,
        name: people.name,
      })
      .from(squadMembers)
      .innerJoin(tournamentPlayers, eq(tournamentPlayers.id, squadMembers.tournamentPlayerId))
      .innerJoin(people, eq(people.id, tournamentPlayers.personId))
      .innerJoin(tournamentTeams, eq(tournamentTeams.id, squadMembers.tournamentTeamId))
      .where(and(eq(tournamentTeams.tournamentId, tournament.id), isNull(squadMembers.leftAt)))
      .orderBy(asc(squadMembers.joinedAt));
    const playersByTeam = new Map<string, string[]>();
    for (const row of memberRows) {
      const list = playersByTeam.get(row.teamId) ?? [];
      list.push(row.name);
      playersByTeam.set(row.teamId, list);
    }
    ceremony = {
      teams: teams.map((team) => {
        const captain = captainByTeam.get(team.id);
        return {
          id: team.id,
          name: team.name,
          logoUrl: mediaUrl(team.logoPath),
          captainName: captain?.name ?? null,
          captainPhotoUrl: mediaUrl(captain?.photoPath),
          players: playersByTeam.get(team.id) ?? [],
        };
      }),
    };
  }

  const liveTeams: LivePayload["teams"] = teams.map((team) => {
    const spent = spentByTeam.get(team.id) ?? 0;
    const captain = captainByTeam.get(team.id);
    const bought = squadCount.get(team.id) ?? 0;
    const seats = teamSeats(
      plan,
      bought,
      teams.filter((other) => other.id !== team.id).map((other) => squadCount.get(other.id) ?? 0),
    );
    const balance = openingPurse(team.openingBalance) - spent;
    const members = [
      ...(captain ? [memberFact(answersByPerson.get(captain.personId))] : []),
      ...(squadFacts.get(team.id) ?? []),
    ];
    const mix = composition(members);
    const flags = latestFlags(blockedRows, team.id);
    return {
      id: team.id,
      name: team.name,
      logoUrl: mediaUrl(team.logoPath),
      balance,
      captainName: captain?.name ?? null,
      captainPhotoUrl: mediaUrl(captain?.photoPath),
      squadCount: bought,
      seatsLeft: seats.left,
      runway: Math.max(0, balance),
      women: {
        state: mix.womenOk === true ? "ok" : flags.womenFail ? "warn" : "idle",
        label: mix.womenLabel,
      },
      cross: {
        state: mix.crossOk ? "ok" : flags.crossFail ? "warn" : "idle",
        label: mix.crossLabel,
      },
    };
  });
  const leading = liveTeams.find((team) => team.id === state?.currentTeamId) ?? null;
  const overPurse =
    state?.status === "open" &&
    state.currentAmount != null &&
    leading != null &&
    state.currentAmount > (leading.balance ?? 0);
  const captainName = leading?.captainName ?? (currentTeam ? (captainByTeam.get(currentTeam.id)?.name ?? null) : null);

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
      currentTeamId: state?.currentTeamId ?? null,
      currentCaptainName: captainName,
      overPurse,
    },
    waiting,
    notice: overPurse
      ? {
        id: `overpurse-${leading.id}-${state?.currentAmount}`,
        teamId: leading.id,
        captainName: captainName ?? "No captain",
        amount: state?.currentAmount ?? 0,
        message: `${captainName ?? "This team"} is over purse`,
        womenFail: false,
        crossFail: false,
        overPurse: true,
      }
      : liveNotice(blockedRows),
    marks: {
      lastBid: bidMark(lastWon),
      topBid: bidMark(topWon),
      saleId: lastWon?.id ?? null,
    },
    player,
    tape,
    teams: liveTeams,
    ceremony,
  };
}

const NOTICE_MS = 6000;

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function liveNotice(
  rows: { id: string; entityId: string | null; payload: Record<string, unknown>; createdAt: Date }[],
): LivePayload["notice"] {
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.createdAt.getTime() > NOTICE_MS) return null;
  const payload = asRecord(row.payload);
  return {
    id: row.id,
    teamId: String(payload.teamId ?? row.entityId ?? ""),
    captainName: String(payload.captainName ?? ""),
    amount: Number(payload.amount ?? 0),
    message: String(payload.message ?? ""),
    womenFail: Boolean(payload.womenFail),
    crossFail: Boolean(payload.crossFail),
    overPurse: false,
  };
}

function latestFlags(
  rows: { entityId: string | null; payload: Record<string, unknown> }[],
  teamId: string,
) {
  const row = rows.find(
    (item) => item.entityId === teamId || String(asRecord(item.payload).teamId ?? "") === teamId,
  );
  const payload = asRecord(row?.payload);
  return {
    womenFail: Boolean(payload.womenFail),
    crossFail: Boolean(payload.crossFail),
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
  for (const row of squadRows) squadCount.set(row.teamId, (squadCount.get(row.teamId) ?? 0) + 1);
  const [poolRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentPlayers)
    .where(auctionPool(tournament.id));
  const seats = seatPlan(Number(poolRow?.count ?? 0), teamRows.length).base;
  const gaps = new Map(
    teamRows.map((team) => [
      team.id,
      squadGap({
        spent: spentByTeam.get(team.id) ?? 0,
        squadCount: squadCount.get(team.id) ?? 0,
        seats,
        openingBalance: team.openingBalance,
      }),
    ]),
  );
  const totals = new Map<string, number>(teamRows.map((team) => [team.id, gaps.get(team.id) ?? 0]));

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
      squadGap: gaps.get(team.id) ?? 0,
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
      photoPath: people.photoPath,
      formAnswers: tournamentPlayers.formAnswers,
    })
    .from(captaincies)
    .innerJoin(people, eq(people.id, captaincies.personId))
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, captaincies.tournamentTeamId))
    .leftJoin(
      tournamentPlayers,
      and(
        eq(tournamentPlayers.personId, people.id),
        eq(tournamentPlayers.tournamentId, tournament.id),
      ),
    )
    .where(and(eq(tournamentTeams.tournamentId, tournament.id), isNull(captaincies.endedAt)));

  const squad = await db
    .select({
      teamId: squadMembers.tournamentTeamId,
      tournamentPlayerId: squadMembers.tournamentPlayerId,
      name: people.name,
      formAnswers: tournamentPlayers.formAnswers,
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
      formAnswers: tournamentPlayers.formAnswers,
    })
    .from(tournamentPlayers)
    .innerJoin(people, eq(people.id, tournamentPlayers.personId))
    .where(eq(tournamentPlayers.tournamentId, tournament.id))
    .orderBy(asc(tournamentPlayers.auctionOrder), asc(people.name));

  const captainPersonIds = new Set(captains.map((captain) => captain.personId));
  const seats = seatPlan(
    playerRows.filter((player) => !captainPersonIds.has(player.personId)).length,
    teams.length,
  ).base;
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
        const roster = squad.filter((member) => member.teamId === team.id);
        return {
          id: team.id,
          name: team.name,
          logoUrl: mediaUrl(team.logoPath),
          openingBalance: openingPurse(team.openingBalance),
          balance: openingPurse(team.openingBalance) - spent,
          penalty: team.penalty,
          captainPersonId: captain?.personId ?? null,
          captainName: captain?.name ?? null,
          captainPhotoUrl: mediaUrl(captain?.photoPath),
          captainGender: captain ? memberFact(captain.formAnswers).gender : "",
          captainDepartment: captain ? memberFact(captain.formAnswers).department : "",
          squadGap: squadGap({
            spent,
            squadCount: roster.length,
            seats,
            openingBalance: team.openingBalance,
          }),
          checks: squadChecks([
            ...(captain ? [memberFact(captain.formAnswers)] : []),
            ...roster.map((member) => memberFact(member.formAnswers)),
          ]),
          squad: roster.map((member) => ({
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
      departments: departmentList(playerRows.map((player) => memberFact(player.formAnswers).department)),
      activity: activity.map((entry) => ({
        id: entry.id,
        action: entry.action,
        createdAt: entry.createdAt.toISOString(),
        payload: entry.payload ?? {},
      })),
    },
  };
}

export async function getPublicTeams(): Promise<PublicTeamList> {
  const tournament = await getActiveTournament();
  if (!tournament) return { tournamentName: null, teams: [] };
  const details = await listTeamCards(tournament.id);
  return { tournamentName: tournament.name, teams: details };
}

export async function getTeamDetail(teamId: string): Promise<TeamDetail | null> {
  if (!isUuid(teamId)) return null;
  const db = getDb();
  const [team] = await db
    .select({
      id: tournamentTeams.id,
      name: tournamentTeams.name,
      logoPath: tournamentTeams.logoPath,
      openingBalance: tournamentTeams.openingBalance,
      tournamentId: tournamentTeams.tournamentId,
      tournamentName: tournaments.name,
    })
    .from(tournamentTeams)
    .innerJoin(tournaments, eq(tournaments.id, tournamentTeams.tournamentId))
    .where(eq(tournamentTeams.id, teamId))
    .limit(1);
  if (!team) return null;

  const cards = await listTeamCards(team.tournamentId);
  const card = cards.find((item) => item.id === team.id);
  const desk = await getTournamentDesk(team.tournamentId);
  const selected = desk.selected;
  const deskTeam = selected?.teams.find((item) => item.id === team.id);
  const captainIds = new Set(
    (selected?.teams ?? []).map((item) => item.captainPersonId).filter((id): id is string => Boolean(id)),
  );
  return {
    id: team.id,
    name: team.name,
    logoUrl: mediaUrl(team.logoPath),
    tournamentId: team.tournamentId,
    tournamentName: team.tournamentName,
    captainName: card?.captainName ?? null,
    captainPhotoUrl: card?.captainPhotoUrl ?? null,
    captainPersonId: deskTeam?.captainPersonId ?? null,
    captainGender: deskTeam?.captainGender ?? "",
    captainDepartment: deskTeam?.captainDepartment ?? "",
    departments: selected?.departments ?? [],
    remaining: card?.remaining ?? openingPurse(team.openingBalance),
    openingBalance: openingPurse(team.openingBalance),
    squadCount: card?.squadCount ?? 0,
    checks: deskTeam?.checks ?? [],
    members: (deskTeam?.squad ?? []).map((member) => ({
      tournamentPlayerId: member.tournamentPlayerId,
      name: member.name,
      photoUrl: selected?.players.find((player) => player.tournamentPlayerId === member.tournamentPlayerId)?.photoUrl ?? null,
      amount: member.refundAmount,
    })),
    available: (selected?.players ?? [])
      .filter(
        (player) =>
          (player.status === "available" || player.status === "unsold") &&
          !player.isCaptain &&
          !captainIds.has(player.personId),
      )
      .map((player) => ({ tournamentPlayerId: player.tournamentPlayerId, name: player.name })),
    people: (selected?.players ?? []).map((player) => ({ personId: player.personId, name: player.name })),
  };
}

async function listTeamCards(tournamentId: string) {
  const db = getDb();
  const teams = await db
    .select()
    .from(tournamentTeams)
    .where(eq(tournamentTeams.tournamentId, tournamentId))
    .orderBy(asc(tournamentTeams.sortOrder), asc(tournamentTeams.name));
  const captains = await db
    .select({
      teamId: captaincies.tournamentTeamId,
      name: people.name,
      photoPath: people.photoPath,
    })
    .from(captaincies)
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, captaincies.tournamentTeamId))
    .innerJoin(people, eq(people.id, captaincies.personId))
    .where(and(eq(tournamentTeams.tournamentId, tournamentId), isNull(captaincies.endedAt)));
  const captainByTeam = new Map(captains.map((row) => [row.teamId, row]));
  const spentRows = await db
    .select({
      teamId: bids.tournamentTeamId,
      spent: sql<number>`coalesce(sum(${bids.amount}), 0)::int`,
    })
    .from(bids)
    .where(and(eq(bids.tournamentId, tournamentId), eq(bids.status, "won")))
    .groupBy(bids.tournamentTeamId);
  const spentByTeam = new Map(spentRows.map((row) => [row.teamId, Number(row.spent)]));
  const squadRows = await db
    .select({ teamId: squadMembers.tournamentTeamId })
    .from(squadMembers)
    .innerJoin(tournamentTeams, eq(tournamentTeams.id, squadMembers.tournamentTeamId))
    .where(and(eq(tournamentTeams.tournamentId, tournamentId), isNull(squadMembers.leftAt)));
  const squadCount = new Map<string, number>();
  for (const row of squadRows) squadCount.set(row.teamId, (squadCount.get(row.teamId) ?? 0) + 1);
  return teams.map((team) => {
    const captain = captainByTeam.get(team.id);
    const spent = spentByTeam.get(team.id) ?? 0;
    return {
      id: team.id,
      name: team.name,
      logoUrl: mediaUrl(team.logoPath),
      captainName: captain?.name ?? null,
      captainPhotoUrl: mediaUrl(captain?.photoPath),
      squadCount: squadCount.get(team.id) ?? 0,
      remaining: openingPurse(team.openingBalance) - spent,
    };
  });
}

function departmentList(values: string[]) {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const department = value.trim();
    if (department && !byKey.has(department.toLowerCase())) byKey.set(department.toLowerCase(), department);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}
