import { LeaderboardView } from "@/components/leaderboard-view";
import { SiteHeader } from "@/components/site-header";
import { getLeaderboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const board = await getLeaderboard();
  return (
    <>
      <SiteHeader tournamentName={board.tournament?.name ?? null} mode="public" />
      <LeaderboardView initial={board} />
    </>
  );
}
