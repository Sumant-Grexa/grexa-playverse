"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addPlayerAction,
  reassignCaptainAction,
  removePlayerAction,
  updateTeamAction,
} from "@/lib/actions/admin";
import { formatMoney } from "@/lib/format";
import { CaptainFactsFields } from "./captain-facts-fields";
import type { ActionResult, TeamDetail } from "@/lib/types";

export function TeamEditor({ team }: { team: TeamDetail }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(task: () => Promise<ActionResult>) {
    setPending(true);
    setMessage(null);
    const result = await task();
    setPending(false);
    setMessage(result.ok ? (result.message ?? "Saved.") : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-4 pb-16">
      <p>
        <Link href="/admin/tournament" className="text-sm text-bid underline">
          Back to roster
        </Link>
      </p>
      {message ? <p className="text-gold">{message}</p> : null}

      <form
        className="arcade-panel p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => updateTeamAction(new FormData(event.currentTarget)));
        }}
      >
        <div className="flex flex-wrap items-center gap-4">
          {team.captainPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={team.captainPhotoUrl} alt="" className="h-16 w-16 rounded-full bg-hall object-cover" />
          ) : null}
          <div>
            <h1 className="font-sans text-4xl font-semibold text-paper">{team.name}</h1>
            <p className="mt-2 text-mist/70">
              Captain {team.captainName ?? "not set"}
              {" · "}
              {formatMoney(team.remaining)} left
            </p>
          </div>
        </div>
        <input type="hidden" name="tournamentId" value={team.tournamentId} />
        <input type="hidden" name="teamId" value={team.id} />
        <label className="mt-5 block">
          <span className="text-sm">Team name</span>
          <input name="name" defaultValue={team.name} required className="field" />
        </label>
        {team.captainPersonId ? (
          <div key={team.captainPersonId} className="mt-4 grid gap-4 sm:grid-cols-2">
            <CaptainFactsFields
              departments={team.departments}
              gender={team.captainGender}
              department={team.captainDepartment}
              listId="captain-departments"
            />
          </div>
        ) : null}
        <label className="mt-4 block">
          <span className="text-sm">Captain photo</span>
          <input name="captainPhoto" type="file" accept="image/*" className="mt-1 block w-full" />
        </label>
        <label className="mt-4 block">
          <span className="text-sm">Team logo</span>
          <input name="logo" type="file" accept="image/*" className="mt-1 block w-full" />
        </label>
        <button type="submit" disabled={pending} className="btn btn-cyan mt-5">
          Save team
        </button>
      </form>

      <form
        className="arcade-panel arcade-panel-cyan p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => reassignCaptainAction(new FormData(event.currentTarget)));
        }}
      >
        <h2 className="text-xl font-semibold text-paper">Captain</h2>
        <input type="hidden" name="tournamentId" value={team.tournamentId} />
        <input type="hidden" name="teamId" value={team.id} />
        <label className="mt-4 block">
          <span className="text-sm">New captain</span>
          <select name="personId" defaultValue={team.captainPersonId ?? ""} required className="field">
            {team.people.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className="btn btn-purple mt-4">
          Change captain
        </button>
      </form>

      <section className="arcade-panel p-6">
        <h2 className="text-xl font-semibold text-paper">Squad</h2>
        {team.members.length === 0 ? (
          <p className="mt-3 text-mist/70">No players yet. The auction is the usual way in.</p>
        ) : (
          <ul className="mt-4 divide-y divide-white/10">
            {team.members.map((member) => (
              <li key={member.tournamentPlayerId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  {member.name}
                  <span className="ml-2 text-sm text-mist/60">{formatMoney(member.amount)}</span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  className="btn btn-danger text-sm"
                  onClick={() => {
                    const data = new FormData();
                    data.set("tournamentId", team.tournamentId);
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
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => addPlayerAction(new FormData(event.currentTarget)));
          }}
        >
          <input type="hidden" name="tournamentId" value={team.tournamentId} />
          <input type="hidden" name="teamId" value={team.id} />
          <label>
            <span className="text-sm">Add available player</span>
            <select name="tournamentPlayerId" required className="field min-w-56">
              {team.available.length === 0 ? (
                <option value="">No one available</option>
              ) : (
                team.available.map((player) => (
                  <option key={player.tournamentPlayerId} value={player.tournamentPlayerId}>
                    {player.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <button type="submit" disabled={pending || team.available.length === 0} className="btn btn-cyan">
            Add
          </button>
        </form>
      </section>
    </div>
  );
}
