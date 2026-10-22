"use client";

import { useEffect, useState } from "react";
import { ClosingShow } from "@/components/closing-show";
import { PlayerStage } from "@/components/player-stage";
import { finalizeBidAction, placeBidAction, resetTestAuctionAction, unsoldAction } from "@/lib/actions/admin";
import { formatMoney } from "@/lib/format";
import { AUCTION_SEATS, bidProblem, nextBidFloor, raiseStep } from "@/lib/rules";
import type { LivePayload } from "@/lib/types";

export function AuctionConsole({ initial }: { initial: LivePayload }) {
  const [live, setLive] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
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

  const floor = nextBidFloor(live.state.currentAmount);
  const step = raiseStep(live.state.currentAmount);
  const lotOpen = live.state.status === "open" && live.player;

  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, raw] of Object.entries(prev)) {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < floor) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [floor]);

  function amountFor(teamId: string) {
    const raw = drafts[teamId];
    if (raw == null || raw.trim() === "") return floor;
    const value = Number(raw);
    return Number.isInteger(value) ? value : floor;
  }

  function writeAmount(teamId: string, value: number) {
    setDrafts((prev) => ({ ...prev, [teamId]: String(value) }));
  }

  function bump(teamId: string, direction: 1 | -1) {
    const current = amountFor(teamId);
    if (direction < 0) {
      if (current <= floor) return;
      const over = (current - floor) % step;
      const drop = over === 0 ? step : over;
      writeAmount(teamId, current - drop);
      return;
    }
    const over = current < floor ? 0 : (current - floor) % step;
    const add = over === 0 ? step : step - over;
    writeAmount(teamId, Math.max(floor, current) + add);
  }

  function place(teamId: string) {
    const value = amountFor(teamId);
    const problem = bidProblem(value, live.state.currentAmount);
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      const result = await placeBidAction(teamId, value);
      if (result.ok) {
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[teamId];
          return next;
        });
      }
      return result;
    });
  }

  async function run(task: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setPending(true);
    setError(null);
    const result = await task();
    setPending(false);
    if (!result.ok) setError(result.error ?? "Could not update the auction");
    else if (result.message) setError(null);
  }

  async function resetTest() {
    setPending(true);
    setError(null);
    setNote(null);
    const result = await resetTestAuctionAction();
    setPending(false);
    setConfirmReset(false);
    if (!result.ok) setError(result.error ?? "Could not reset the test");
    else setNote(result.message ?? "Reset.");
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-mist/60">Testing only. Teams, captains, and the roster stay.</p>
        {confirmReset ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger" disabled={pending} onClick={() => void resetTest()}>
              Clear and start
            </button>
            <button type="button" className="btn btn-purple" disabled={pending} onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-gold" disabled={pending} onClick={() => setConfirmReset(true)}>
            Reset test
          </button>
        )}
      </div>
      {note ? <p className="text-bid">{note}</p> : null}
      {error ? <p className="text-gold">{error}</p> : null}
      {live.ceremony ? <ClosingShow teams={live.ceremony.teams} /> : null}
      {live.ceremony ? null : (
      <>
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
          className="btn btn-purple"
        >
          Unsold
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {live.teams.map((team, index) => {
          const current = live.state.currentTeamName === team.name && live.state.currentAmount != null;
          const amount = amountFor(team.id);
          const typed = drafts[team.id] ?? "";
          return (
            <article
              key={team.id}
              className={`arcade-panel px-4 py-4 text-left ${
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
                  <span className="block text-xl text-paper">{team.name}</span>
                  <span className="block text-sm opacity-70">
                    {team.captainName ?? "No captain"}
                    {" · "}
                    {formatMoney(team.balance ?? 0)} left
                    {" · "}
                    {team.squadCount} of {AUCTION_SEATS} bought
                  </span>
                </span>
              </span>
              <p className="mt-4 text-center font-sans text-2xl font-semibold text-bid">{formatMoney(amount)}</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-step btn-purple"
                  aria-label={`Lower the bid for ${team.name}`}
                  disabled={pending || !lotOpen || amount <= floor}
                  onClick={() => bump(team.id, -1)}
                >
                  -
                </button>
                <input
                  inputMode="numeric"
                  aria-label={`Bid amount for ${team.name}`}
                  value={typed}
                  placeholder={String(floor)}
                  disabled={pending || !lotOpen}
                  onChange={(event) => {
                    setError(null);
                    setDrafts((prev) => ({ ...prev, [team.id]: event.target.value.replace(/[^\d]/g, "") }));
                  }}
                  className="field mt-0 min-w-0 text-center text-lg"
                />
                <button
                  type="button"
                  className="btn btn-step btn-cyan"
                  aria-label={`Raise the bid for ${team.name}`}
                  disabled={pending || !lotOpen}
                  onClick={() => bump(team.id, 1)}
                >
                  +
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-mist/60">Steps of {formatMoney(step)}</p>
              <button
                type="button"
                className="btn btn-cyan mt-3 w-full"
                disabled={pending || !lotOpen}
                onClick={() => place(team.id)}
              >
                Place bid
              </button>
            </article>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
