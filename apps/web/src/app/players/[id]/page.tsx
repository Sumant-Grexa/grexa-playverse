import Link from "next/link";
import { notFound } from "next/navigation";
import { PlayerCard } from "@/components/player-card";
import { SiteHeader } from "@/components/site-header";
import { formatMoney, monogram } from "@/lib/format";
import { getActiveTournament, getPlayerDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  available: "Waiting for auction",
  on_block: "On the block",
  sold: "Sold",
  unsold: "Unsold",
} as const;

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await getPlayerDetail(id);
  if (!player) notFound();
  const active = await getActiveTournament();
  const team = player.team;
  return (
    <>
      <SiteHeader tournamentName={active?.name ?? player.tournamentName} mode="public" />
      <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 px-4 pb-16">
        <Link href={team ? `/teams/${team.id}` : "/teams"} className="text-sm text-bid underline">
          {team ? `Back to ${team.name}` : "All teams"}
        </Link>
        <article className="player-card arcade-panel arcade-panel-cyan overflow-hidden">
          <PlayerCard player={player} />
          <div className="flex flex-wrap items-center gap-4 border-t border-white/10 px-5 py-4 sm:px-6">
            {team ? (
              <Link href={`/teams/${team.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-hall text-sm font-bold text-bid">
                  {team.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={team.logoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    monogram(team.name)
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold text-paper">{team.name}</span>
                  <span className="block text-sm text-mist/70">
                    {team.role === "captain" ? "Captain" : "Squad member"}
                  </span>
                </span>
              </Link>
            ) : (
              <span className="flex-1 text-lg text-mist/70">{STATUS_LABEL[player.status]}</span>
            )}
            {player.soldFor != null ? (
              <span className="shrink-0 text-right">
                <span className="block text-sm text-mist/70">Sold for</span>
                <span className="block font-sans text-2xl font-extrabold text-bid">{formatMoney(player.soldFor)}</span>
              </span>
            ) : null}
          </div>
        </article>
      </main>
    </>
  );
}
