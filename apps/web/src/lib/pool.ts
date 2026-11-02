import { captaincies, tournamentPlayers, tournamentTeams } from "@playverse/db";
import { and, eq, sql } from "drizzle-orm";

/** Players who go under the hammer: everyone in the tournament except the sitting captains. */
export function auctionPool(tournamentId: string) {
  return and(
    eq(tournamentPlayers.tournamentId, tournamentId),
    sql`not exists (
      select 1 from ${captaincies}
      inner join ${tournamentTeams} on ${tournamentTeams.id} = ${captaincies.tournamentTeamId}
      where ${tournamentTeams.tournamentId} = ${tournamentId}
        and ${captaincies.endedAt} is null
        and ${captaincies.personId} = ${tournamentPlayers.personId}
    )`,
  );
}
