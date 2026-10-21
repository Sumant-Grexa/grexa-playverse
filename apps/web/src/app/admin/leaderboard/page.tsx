import { ScoreEditor } from "@/components/score-editor";
import { SiteHeader } from "@/components/site-header";
import { getLeaderboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AdminLeaderboardPage() {
  const board = await getLeaderboard();
  return (
    <>
      <SiteHeader tournamentName={board.tournament?.name ?? null} mode="admin" />
      <ScoreEditor key={board.games.map((game) => game.id).join()} initial={board} />
    </>
  );
}
