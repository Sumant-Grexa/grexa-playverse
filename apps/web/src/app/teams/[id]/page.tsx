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
                Captain{" "}
                {team.captainName && team.captainPlayerId ? (
                  <Link href={`/players/${team.captainPlayerId}`} className="text-paper underline">
                    {team.captainName}
                  </Link>
                ) : (
                  (team.captainName ?? "not set")
                )}
                {team.captainDepartment ? ` (${team.captainDepartment})` : null}
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
                <li key={member.tournamentPlayerId}>
                  <Link
                    href={`/players/${member.tournamentPlayerId}`}
                    className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-hall-2/50"
                  >
                    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-hall text-sm font-bold text-bid">
                      {member.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={member.photoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        monogram(member.name)
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-paper">{member.name}</span>
                      <span className="block truncate text-sm text-mist/70">
                        {member.department || "Department not set"}
                      </span>
                    </span>
                    <span className="shrink-0 text-bid">{formatMoney(member.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
