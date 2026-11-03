"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createTeamAction,
  importRoster,
  savePlaceholdersAction,
  uploadPhoto,
} from "@/lib/actions/admin";
import { formatMoney, formatWhen, monogram } from "@/lib/format";
import { CaptainFactsFields } from "./captain-facts-fields";
import type { ActionResult, TournamentDesk, TournamentSummary } from "@/lib/types";

export function TournamentManager({
  desk,
  tournaments,
}: {
  desk: NonNullable<TournamentDesk["selected"]>;
  tournaments: TournamentSummary[];
}) {
  const router = useRouter();
  const [importResult, setImportResult] = useState<ActionResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(task: () => Promise<ActionResult>) {
    setPending(true);
    setMessage(null);
    const result = await task();
    setPending(false);
    setMessage(result.ok ? (result.message ?? "Saved.") : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 pb-16">
      <section className="arcade-panel p-6">
        <h1 className="font-sans text-4xl font-semibold text-paper">{desk.name}</h1>
        <p className="mt-2 text-mist/70">
          {desk.status === "active" ? "This tournament is live on the board." : `Status: ${desk.status}`}
        </p>
        <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          setPending(true);
          const result = await importRoster(null, new FormData(form));
          setPending(false);
          setImportResult(result);
          if (result.ok) router.refresh();
        }}>
          <input type="hidden" name="tournamentId" value={desk.id} />
          <label className="block md:col-span-2">
            <span className="text-sm">Settled CSV</span>
            <input name="csv" type="file" accept=".csv,text/csv" required className="mt-1 block w-full" />
          </label>
          <div className="md:col-span-2">
            <button type="submit" disabled={pending} className="btn btn-cyan">
              Import roster
            </button>
            <a className="ml-4 text-sm underline" href="/sample/settled.csv">
              Sample CSV
            </a>
            {importResult ? (
              <p className="mt-3">{importResult.ok ? importResult.message : importResult.error}</p>
            ) : (
              <p className="mt-3 max-w-2xl text-sm text-mist/70">
                Import people only. Teams are created below from a captain name. Importing again updates people and leaves teams in place.
              </p>
            )}
          </div>
        </form>
      </section>

      <section className="arcade-panel p-6">
        <h2 className="font-sans text-2xl font-semibold text-paper">Teams</h2>
        <p className="mt-2 max-w-2xl text-sm text-mist/70">
          Add a captain by name, gender, department, and photo. Gender and department count toward
          the women (W) and department (T) checks. The side starts as that person&apos;s team, empty, with
          ₹1,00,00,000. You can rename it later.
        </p>
        <form
          action={createTeamAction}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="tournamentId" value={desk.id} />
          <label>
            <span className="text-sm">Captain name</span>
            <input name="captainName" required placeholder="Asha Raman" className="field min-w-64" />
          </label>
          <label>
            <span className="text-sm">Captain photo</span>
            <input name="photo" type="file" accept="image/*" className="mt-1 block w-full max-w-56" />
          </label>
          <CaptainFactsFields departments={desk.departments} required listId="new-captain-departments" />
          <button type="submit" className="btn btn-cyan">
            Add team
          </button>
        </form>
        <div className="mt-6 grid gap-3">
          {desk.teams.map((team) => (
            <Link key={team.id} href={`/admin/team/${team.id}`} className="flex items-center justify-between gap-3 border-b border-white/10 py-3">
              <span className="flex min-w-0 items-center gap-3">
                {team.captainPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={team.captainPhotoUrl} alt="" className="h-12 w-12 rounded-full bg-hall object-cover" />
                ) : (
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-hall text-sm text-bid">
                    {monogram(team.captainName ?? team.name)}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold text-paper">{team.name}</span>
                  <span className="block truncate text-sm text-mist/70">
                    Captain {team.captainName ?? "not set"}
                    {" · "}
                    {formatMoney(team.balance ?? 0)} left
                    {" · "}
                    {team.squad.length} bought
                  </span>
                </span>
              </span>
              <span className="text-sm text-bid">Edit</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="arcade-panel arcade-panel-cyan p-6">
        <h2 className="pixel-label text-bid">People</h2>
        <ul className="mt-4 divide-y divide-white/10">
          {desk.players.map((player) => (
            <li key={player.tournamentPlayerId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                {player.name}
                <span className="ml-2 text-sm text-mist/60">
                  {player.isCaptain ? "captain" : player.status}
                  {player.wantsToBeCaptain ? " · asked to captain" : ""}
                </span>
              </span>
              <form action={uploadPhoto} className="flex items-center gap-2">
                <input type="hidden" name="tournamentId" value={desk.id} />
                <input type="hidden" name="personId" value={player.personId} />
                <input name="photo" type="file" accept="image/*" className="max-w-48 text-sm" />
                <button type="submit" className="btn btn-cyan text-sm">
                  Save photo
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <form
        className="arcade-panel arcade-panel-cyan p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => savePlaceholdersAction(new FormData(event.currentTarget)));
        }}
      >
        <h2 className="pixel-label text-bid">Notes</h2>
        <p className="mt-2 max-w-2xl text-sm text-mist/70">
          Scratch pad only. These numbers are not the live auction. Purse, opening bid, and bid jumps on
          the board stay fixed in code: ₹1,00,00,000 purse, first bid ₹3,00,000, then steps of ₹50,000 /
          ₹1,00,000 / ₹2,00,000. A full side is the auction pool split evenly across teams, plus the captain; any leftover players go up as final lots once every team is full. Saving here does not change
          those rules, the purse, or any bid already placed.
        </p>
        <input type="hidden" name="tournamentId" value={desk.id} />
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <label>
            Previous tournament
            <select
              name="previousTournamentId"
              defaultValue={desk.previousTournamentId ?? ""}
              className="field"
            >
              <option value="">None</option>
              {tournaments
                .filter((tournament) => tournament.id !== desk.id)
                .map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.name}
                  </option>
                ))}
            </select>
          </label>
          <NumberField name="minBid" label="Minimum bid" defaultValue={desk.minBid} />
          <NumberField name="maxBid" label="Maximum bid" defaultValue={desk.maxBid} />
          <NumberField name="bidJump" label="Bid jump" defaultValue={desk.bidJump} />
        </div>
        <div className="mt-4 grid gap-3">
          {desk.teams.map((team) => (
            <label key={team.id} className="flex items-center justify-between gap-3">
              <span>{team.name} penalty</span>
              <input type="hidden" name="penaltyTeamId" value={team.id} />
              <input
                name="penaltyValue"
                defaultValue={team.penalty ?? ""}
                inputMode="numeric"
                className="field w-32"
              />
            </label>
          ))}
        </div>
        <button type="submit" disabled={pending} className="btn btn-gold mt-4">
          Save notes
        </button>
      </form>

      <section>
        <h2 className="pixel-label text-gold">Activity</h2>
        {desk.activity.length === 0 ? (
          <p className="mt-3 text-mist/70">Nothing has been logged yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {desk.activity.map((entry) => (
              <li key={entry.id} className="arcade-panel px-4 py-3">
                <p>{entry.action}</p>
                <p className="text-sm text-mist/60">
                  {formatWhen(entry.createdAt)}
                  {" · "}
                  {JSON.stringify(entry.payload)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      {message ? <p className="text-gold">{message}</p> : null}
    </div>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: number | null;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        inputMode="numeric"
        className="field"
      />
    </label>
  );
}
