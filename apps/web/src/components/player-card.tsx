import type { ReactNode } from "react";
import { badgeLook, monogram } from "@/lib/format";

export type PlayerCardData = {
  name: string;
  photoUrl: string | null;
  department: string;
  badge: string | null;
  skills: string[];
};

/** Photo, name, department, trait and skills: the card shown on the block and on a player's page. */
export function PlayerCard({ player, children }: { player: PlayerCardData; children?: ReactNode }) {
  const badge = badgeLook(player.badge);
  return (
    <div className="grid items-start gap-5 p-5 sm:grid-cols-[minmax(220px,340px)_minmax(0,1fr)] sm:p-6">
      <div className="player-photo">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-hall text-paper">
          {player.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={player.photoUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="font-display text-6xl text-bid">{monogram(player.name)}</span>
          )}
        </div>
      </div>
      <div className="player-copy">
        <div>
          <h1 className="font-sans text-4xl font-semibold leading-none tracking-tight text-paper sm:text-5xl">
            {player.name}
          </h1>
          <br />
          {player.department ? (
            <p className="mt-4 text-xl text-mist/80">
              <span className="pixel-label card-label text-bid">Dept</span>{" "}
              <span className="ml-4 text-2xl font-semibold text-paper sm:text-3xl">{player.department}</span>
            </p>
          ) : null}
          {badge ? (
            <>
              <p className="pixel-label card-label mt-5 text-bid">Trait</p>
              <span className={`trait-tag trait-tag-${badge.kind} mt-2`}>{badge.label}</span>
            </>
          ) : null}
          <p className="pixel-label card-label mt-5 text-bid">Skills</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {player.skills.length === 0 ? (
              <span className="text-lg text-mist/60">No skills listed</span>
            ) : (
              player.skills.map((skill) => (
                <span key={skill} className="skill-chip">
                  {skill}
                </span>
              ))
            )}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
