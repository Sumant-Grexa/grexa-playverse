import { SiteHeader } from "@/components/site-header";
import { TeamCardList } from "@/components/team-card-list";
import { getActiveTournament, getPublicTeams } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const active = await getActiveTournament();
  const list = await getPublicTeams();
  return (
    <>
      <SiteHeader tournamentName={active?.name ?? list.tournamentName} mode="public" />
      <main className="mx-auto w-full max-w-[1400px] px-4 pb-16">
        <h1 className="mb-6 font-sans text-4xl font-semibold text-paper">Teams</h1>
        <TeamCardList list={list} hrefFor={(id) => `/teams/${id}`} />
      </main>
    </>
  );
}
