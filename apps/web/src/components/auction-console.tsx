"use client";

import { useEffect, useState } from "react";
import { ClosingShow } from "@/components/closing-show";
import { SoldStamp } from "@/components/sold-stamp";
import { finalizeBidAction, placeBidAction, resetTestAuctionAction, unsoldAction } from "@/lib/actions/admin";
import { formatLakhs, formatMoney } from "@/lib/format";
import { bidProblem, nextBidFloor, raiseStep } from "@/lib/rules";
import { playBuzzSound, primeSoldSound } from "@/lib/sold-sound";
import type { LivePayload } from "@/lib/types";

export function AuctionConsole({ initial }: { initial: LivePayload }) {
  const [live, setLive] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, setPending] = useState(false);
  const [stampPulse, setStampPulse] = useState(0);

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
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!/^[1-8]$/.test(event.key)) return;
      const team = live.teams[Number(event.key) - 1];
      if (!team || !lotOpen || pending) return;
      if (team.seatsLeft <= 0) return;
      event.preventDefault();
      place(team.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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

  async function run(task: () => Promise<{ ok: boolean; error?: string; message?: string; buzz?: boolean }>) {
    setPending(true);
    setError(null);
    const result = await task();
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Could not update the auction");
      if (result.buzz) playBuzzSound();
    } else if (result.message) setError(null);
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
      {error ? <p className={live.notice ? "text-danger" : "text-gold"}>{error}</p> : null}
      {live.notice ? (
        <p className={live.notice.overPurse ? "rule-notice rule-notice-hold" : "rule-notice"}>
          {live.notice.message}
        </p>
      ) : null}
      <SoldStamp saleId={null} pulse={stampPulse} />
      {live.ceremony ? <ClosingShow teams={live.ceremony.teams} /> : null}
      {live.ceremony ? null : (
      <>
      <div className="flex flex-wrap items-center gap-3 border border-white/15 bg-hall-2 px-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-bold text-paper">{live.player?.name ?? "No player"}</p>
          <p className="text-sm text-mist/70">
            {live.state.currentCaptainName ?? "No bid"}
            {live.marks.lastBid ? ` · last ${formatMoney(live.marks.lastBid.amount)}` : ""}
            {live.marks.topBid ? ` · top ${formatMoney(live.marks.topBid.amount)}` : ""}
          </p>
        </div>
        <p className={`font-sans text-4xl font-extrabold ${live.state.overPurse ? "bid-slashed text-danger" : "text-bid"}`}>
          {live.state.currentAmount == null ? "—" : formatMoney(live.state.currentAmount)}
        </p>
        <button
          type="button"
          disabled={pending || !lotOpen}
          onClick={() => {
            primeSoldSound();
            void run(async () => {
              const result = await finalizeBidAction();
              if (result.ok) setStampPulse((value) => value + 1);
              return result;
            });
          }}
          className="btn btn-cyan px-6 py-4 text-lg"
        >
          Final
        </button>
        <button
          type="button"
          disabled={pending || !lotOpen}
          onClick={() => run(() => unsoldAction())}
          className="btn btn-purple px-6 py-4 text-lg"
        >
          Unsold
        </button>
      </div>
      <p className="text-sm text-mist/60">Keys 1–8 bid that team. + raises the amount before you send it.</p>
      <div className="grid gap-2 lg:grid-cols-2">
        {live.teams.map((team, index) => {
          const current = live.state.currentTeamId === team.id && live.state.currentAmount != null;
          const amount = amountFor(team.id);
          const typed = drafts[team.id] ?? "";
          const full = team.seatsLeft <= 0;
          const overPurse = amount > (team.balance ?? 0);
          const who = team.captainName ?? "No captain";
          return (
            <div
              key={team.id}
              className={`flex items-center gap-2 border px-2 py-2 ${
                current ? "border-bid bg-hall-2" : "border-white/15"
              }`}
            >
              <span className="w-6 shrink-0 text-center text-lg font-bold text-bid">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-semibold leading-tight text-paper">{who}</span>
                <span className={`block truncate text-xs ${(team.balance ?? 0) < 0 ? "text-danger" : "text-mist/70"}`}>
                  {formatLakhs(team.balance ?? 0)} left · {team.seatsLeft} seats · W{team.women.state === "ok" ? "✓" : team.women.state === "warn" ? "!" : ""} T{team.cross.state === "ok" ? "✓" : team.cross.state === "warn" ? "!" : ""}
                  {overPurse ? " · over purse" : ""}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-step btn-purple"
                aria-label={`Lower the bid for ${who}`}
                disabled={pending || !lotOpen || amount <= floor}
                onClick={() => bump(team.id, -1)}
              >
                -
              </button>
              <button
                type="button"
                className="btn btn-cyan min-w-32 px-3"
                disabled={pending || !lotOpen || full}
                onClick={() => place(team.id)}
              >
                {formatMoney(amount)}
              </button>
              <button
                type="button"
                className="btn btn-step btn-cyan"
                aria-label={`Raise the bid for ${who}`}
                disabled={pending || !lotOpen}
                onClick={() => bump(team.id, 1)}
              >
                +
              </button>
              <input
                inputMode="numeric"
                aria-label={`Custom bid for ${who}`}
                value={typed}
                placeholder={String(floor)}
                disabled={pending || !lotOpen}
                onChange={(event) => {
                  setError(null);
                  setDrafts((prev) => ({ ...prev, [team.id]: event.target.value.replace(/[^\d]/g, "") }));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") place(team.id);
                }}
                className="field mt-0 shrink-0 text-center"
                style={{ width: "7.5rem" }}
              />
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
