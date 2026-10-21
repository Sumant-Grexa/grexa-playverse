"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  importRoster,
  reassignCaptainAction,
  removePlayerAction,
  savePlaceholdersAction,
  uploadPhoto,
} from "@/lib/actions/admin";
import { formatMoney, formatWhen } from "@/lib/format";
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
          <label className="block">
            <span className="text-sm">Settled CSV</span>
            <input name="csv" type="file" accept=".csv,text/csv" required className="mt-1 block w-full" />
          </label>
          <label className="block">
            <span className="text-sm">Team logos</span>
            <input name="logos" type="file" accept="image/*" multiple className="mt-1 block w-full" />
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
                Captains arrive with an empty team. Everyone else stays in the auction. Importing again replaces this tournament&apos;s roster.
              </p>
            )}
          </div>
        </form>
      </section>

      <form
        className="arcade-panel arcade-panel-cyan p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => savePlaceholdersAction(new FormData(event.currentTarget)));
        }}
      >
        <h2 className="pixel-label text-bid">Placeholders</h2>
        <p className="mt-2 max-w-2xl text-sm text-mist/70">
          Minimum bid, maximum bid, bid jump, and penalty are stored here and are not applied yet.
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
          Save placeholders
        </button>
      </form>

      <section className="grid gap-4">
        {desk.teams.map((team) => (
          <article key={team.id} className="arcade-panel p-5">
            <div className="flex flex-wrap items-center gap-4">
              {team.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={team.logoUrl} alt="" className="h-14 w-14 rounded-full bg-hall object-cover" />
              ) : null}
              <div>
                <h2 className="font-sans text-2xl font-semibold text-paper">{team.name}</h2>
                <p className="text-sm text-mist/70">
                  Captain {team.captainName ?? "not set"}
                  {" · "}
                  {team.balance == null
                    ? "balance not set"
                    : `${formatMoney(team.balance)} left of ${formatMoney(team.openingBalance ?? 0)}`}
                  {" · "}
                  {team.squad.length === 1 ? "1 player" : `${team.squad.length} players`}
                </p>
              </div>
            </div>
            <form
              className="mt-4 flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => reassignCaptainAction(new FormData(event.currentTarget)));
              }}
            >
              <input type="hidden" name="tournamentId" value={desk.id} />
              <input type="hidden" name="teamId" value={team.id} />
              <label>
                <span className="text-sm">New captain</span>
                <select name="personId" defaultValue={team.captainPersonId ?? ""} required className="field">
                  {desk.players.map((player) => (
                    <option key={player.personId} value={player.personId}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={pending} className="btn btn-purple">
                Reassign captain
              </button>
            </form>
            {team.squad.length === 0 ? (
              <p className="mt-4 text-sm text-mist/70">No players yet. The auction is the only way in.</p>
            ) : (
              <ul className="mt-4 divide-y divide-white/10">
                {team.squad.map((member) => (
                  <li key={member.tournamentPlayerId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span>
                      {member.name}
                      <span className="ml-2 text-sm text-gold">
                        Remove returns {formatMoney(member.refundAmount)}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      className="btn btn-danger text-sm"
                      onClick={() => {
                        const confirmed = window.confirm(
                          `Remove ${member.name} and return ${formatMoney(member.refundAmount)} to ${team.name}?`,
                        );
                        if (!confirmed) return;
                        const data = new FormData();
                        data.set("tournamentId", desk.id);
                        data.set("teamId", team.id);
                        data.set("tournamentPlayerId", member.tournamentPlayerId);
                        void run(() => removePlayerAction(data));
                      }}
                    >
                      Remove and refund
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
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
