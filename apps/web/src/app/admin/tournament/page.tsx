import { activateTournament, createTournament } from "@/lib/actions/admin";
import { SiteHeader } from "@/components/site-header";
import { TournamentManager } from "@/components/tournament-manager";
import { getActiveTournament, getTournamentDesk } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TournamentPage({
  searchParams,
}: {
  searchParams: Promise<{ tournament?: string; error?: string }>;
}) {
  const params = await searchParams;
  const desk = await getTournamentDesk(params.tournament);
  const active = await getActiveTournament();

  return (
    <>
      <SiteHeader tournamentName={active?.name ?? desk.selected?.name ?? null} mode="admin" />
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4">
        <form action={createTournament} className="flex flex-wrap items-end gap-3">
          <label>
            <span className="text-sm">New tournament</span>
            <input name="name" required placeholder="1.0" className="field" />
          </label>
          <button type="submit" className="btn btn-cyan">
            Create
          </button>
        </form>
        {params.error ? <p className="text-gold">{params.error}</p> : null}
        {desk.tournaments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {desk.tournaments.map((tournament) => (
              <a
                key={tournament.id}
                href={`/admin/tournament?tournament=${tournament.id}`}
                className={desk.selected?.id === tournament.id ? "nav-link nav-link-current" : "nav-link"}
              >
                {tournament.name}
                {tournament.status === "active" ? " · live" : ""}
              </a>
            ))}
          </div>
        ) : (
          <p className="text-mist/70">Create a tournament, then import the settled CSV.</p>
        )}
        {desk.selected && desk.selected.status !== "active" ? (
          <form action={activateTournament}>
            <input type="hidden" name="tournamentId" value={desk.selected.id} />
            <button type="submit" className="btn btn-purple">
              Make {desk.selected.name} live
            </button>
          </form>
        ) : null}
      </div>
      {desk.selected ? (
        <TournamentManager
          key={desk.selected.id}
          desk={desk.selected}
          tournaments={desk.tournaments}
        />
      ) : null}
    </>
  );
}
