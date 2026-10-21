"use client";

import { useEffect, useState } from "react";
import { PlayerStage } from "@/components/player-stage";
import {
  finalizeBidAction,
  nextPlayerAction,
  placeBidAction,
  unsoldAction,
} from "@/lib/actions/admin";
import { formatMoney } from "@/lib/format";
import type { LivePayload } from "@/lib/types";

export function AuctionConsole({ initial }: { initial: LivePayload }) {
  const [live, setLive] = useState(initial);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch("/api/live", { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as LivePayload;
        if (!cancelled) setLive(next);
      } catch {
        // Keep the last good frame on screen.
      }
    }
    const timer = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (teamId) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const index = Number(event.key) - 1;
      const team = live.teams[index];
      if (!event.key.match(/^[1-9]$/) || !team) return;
      event.preventDefault();
      setError(null);
      setAmount("");
      setTeamId(team.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live.teams, teamId]);

  const openTeam = live.teams.find((team) => team.id === teamId) ?? null;
  const lotOpen = live.state.status === "open" && live.player;

  async function run(task: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setPending(true);
    setError(null);
    const result = await task();
    setPending(false);
    if (!result.ok) setError(result.error ?? "Could not update the auction");
    else if (result.message) setError(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pb-12">
      <PlayerStage live={live} />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending || !lotOpen}
          onClick={() => run(() => finalizeBidAction())}
          className="btn btn-cyan"
        >
          Final
        </button>
        <button
          type="button"
          disabled={pending || !lotOpen}
          onClick={() => run(() => unsoldAction())}
          className="btn btn-danger"
        >
          Unsold
        </button>
        <button
          type="button"
          disabled={pending || live.state.status === "open"}
          onClick={() => run(() => nextPlayerAction())}
          className="btn btn-gold"
        >
          Next player
        </button>
      </div>
      {error ? <p className="text-gold">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {live.teams.map((team, index) => {
          const current = live.state.currentTeamName === team.name && live.state.currentAmount != null;
          return (
            <button
              key={team.id}
              type="button"
              disabled={pending || !lotOpen}
              onClick={() => {
                setError(null);
                setAmount("");
                setTeamId(team.id);
              }}
              className={`arcade-panel rounded-2xl px-4 py-4 text-left disabled:opacity-40 ${
                current ? "border-gold text-paper" : "arcade-panel-cyan text-mist"
              }`}
            >
              <span className="font-display text-sm text-bid">{index + 1}</span>
              <span className="mt-3 flex items-center gap-3">
                {team.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={team.logoUrl} alt="" className="h-10 w-10 rounded-full bg-hall object-cover" />
                ) : null}
                <span>
                  <span className="block text-xl">{team.name}</span>
                  <span className="block text-sm opacity-70">
                    {team.captainName ?? "No captain"}
                    {" · "}
                    {team.balance == null ? "balance not set" : `${formatMoney(team.balance)} left`}
                    {" · "}
                    {team.squadCount} bought
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {openTeam ? (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-hall/80 p-4 sm:items-center">
          <form
            className="arcade-panel w-full max-w-md p-6 text-paper"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(amount);
              if (!Number.isInteger(value) || value < 0) {
                setError("Enter the bid as a whole number");
                return;
              }
              const biddingTeam = openTeam.id;
              setTeamId(null);
              void run(() => placeBidAction(biddingTeam, value));
            }}
          >
            <h2 className="font-sans text-3xl font-semibold leading-none">Bid from {openTeam.name}</h2>
            <p className="mt-2 text-mist/80">
              {live.player ? `For ${live.player.name}. ` : ""}
              Type the amount the captain said.
            </p>
            <label className="mt-5 block">
              <span className="text-sm">Amount</span>
              <input
                autoFocus
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="field text-2xl"
              />
            </label>
            <div className="mt-5 flex gap-3">
              <button type="submit" className="btn btn-cyan">
                Place bid
              </button>
              <button
                type="button"
                className="rounded-full px-5 py-3"
                onClick={() => setTeamId(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
