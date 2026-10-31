import Link from "next/link";
import { formatLakhs, monogram } from "@/lib/format";
import type { PublicTeamList } from "@/lib/types";

export function TeamCardList({ list, hrefFor }: { list: PublicTeamList; hrefFor: (id: string) => string }) {
  if (list.teams.length === 0) {
    return <p className="text-mist/70">No teams yet. Add captains from the admin roster.</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {list.teams.map((team) => (
        <Link key={team.id} href={hrefFor(team.id)} className="arcade-panel arcade-panel-cyan p-5">
          <span className="flex items-center gap-3">
            {team.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.logoUrl} alt="" className="h-14 w-14 rounded-full bg-hall object-cover" />
            ) : (
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-hall text-bid">
                {monogram(team.captainName ?? team.name)}
              </span>
            )}
            <span>
              <span className="block font-sans text-2xl font-semibold text-paper">{team.name}</span>
              <span className="block text-sm text-mist/70">{team.captainName ?? "No captain"}</span>
            </span>
          </span>
          <span className="mt-4 block text-sm text-mist/70">
            {team.squadCount} bought · {formatLakhs(team.remaining)} left
          </span>
        </Link>
      ))}
    </div>
  );
}
