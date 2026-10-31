import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { formatMoney, monogram } from "@/lib/format";
import { getActiveTournament, getTeamDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = await getTeamDetail(id);
  if (!team) notFound();
  const active = await getActiveTournament();
  return (
    <>
      <SiteHeader tournamentName={active?.name ?? team.tournamentName} mode="public" />
      <main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-4 pb-16">
        <Link href="/teams" className="text-sm text-bid underline">
          All teams
        </Link>
        <article className="arcade-panel arcade-panel-cyan p-6">
          <div className="flex flex-wrap items-center gap-4">
            {team.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.logoUrl} alt="" className="h-20 w-20 rounded-full bg-hall object-cover" />
            ) : (
              <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-hall text-2xl text-bid">
                {monogram(team.captainName ?? team.name)}
              </span>
            )}
            <div>
              <h1 className="font-sans text-4xl font-semibold text-paper">{team.name}</h1>
              <p className="mt-2 text-mist/70">
                Captain {team.captainName ?? "not set"}
                {" · "}
                {formatMoney(team.remaining)} left
              </p>
            </div>
          </div>
        </article>
        <section className="arcade-panel p-6">
          <h2 className="text-xl font-semibold text-paper">Squad</h2>
          {team.members.length === 0 ? (
            <p className="mt-3 text-mist/70">No players bought yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-white/10">
              {team.members.map((member) => (
                <li key={member.tournamentPlayerId} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-paper">{member.name}</span>
                  <span className="text-bid">{formatMoney(member.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
