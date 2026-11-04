"use client";

import { useEffect, useRef, useState } from "react";
import { ClosingShow } from "@/components/closing-show";
import { SoldStamp } from "@/components/sold-stamp";
import { finalizeBidAction, placeBidAction, resetTestAuctionAction, unsoldAction } from "@/lib/actions/admin";
import { formatLakhs, formatMoney } from "@/lib/format";
import { bidProblem, isWoman, MAX_PER_DEPARTMENT, memberFact, nextBidFloor, outOfMoney, raiseStep } from "@/lib/rules";
import { playBuzzSound, primeSoldSound } from "@/lib/sold-sound";
import type { LivePayload, SquadOutlook } from "@/lib/types";

/**
 * Admin-only heads-up, never a block: a team that already has its women bids on a woman
 * while the women still to come cannot cover what the other teams need.
 */
function womenSupplyWarning(live: LivePayload, teamId: string): string | null {
  if (!live.player || !isWoman(memberFact(live.player.formAnswers).gender)) return null;
  const team = live.teams.find((item) => item.id === teamId);
  if (!team || team.needs.women > 0) return null;
  const short = live.teams.filter((item) => item.id !== teamId && item.seatsLeft > 0 && item.needs.women > 0);
  const needed = short.reduce((sum, item) => sum + item.needs.women, 0);
  if (live.womenWaiting >= needed) return null;
  const who = team.captainName ?? team.name;
  const list = short.map((item) => `${item.captainName ?? item.name} (${item.needs.women})`).join(", ");
  return (
    `${who} already has the women they need. If they win ${live.player.name}, only ${live.womenWaiting} ` +
    `${live.womenWaiting === 1 ? "woman is" : "women are"} left for teams that still need ${needed}: ${list}. ` +
    `Those teams may not be able to fill their last seat.`
  );
}

function Outlook({ outlook }: { outlook: SquadOutlook }) {
  const womenBad = outlook.womenShort > 0;
  const deptBad = outlook.departmentsShort > 0;
  return (
    <>
      <span className={womenBad ? "text-danger" : outlook.womenNeeded === 0 ? "text-bid" : ""}>
        W {outlook.women}/{outlook.women + outlook.womenNeeded}
        {womenBad ? ` (short ${outlook.womenShort})` : ""}
      </span>
      {" · "}
      <span className={deptBad ? "text-danger" : outlook.departmentsNeeded === 0 ? "text-bid" : ""}>
        Depts {outlook.departments}/{outlook.departments + outlook.departmentsNeeded}
        {deptBad ? ` (short ${outlook.departmentsShort})` : ""}
      </span>
      {" · "}
      <span className={outlook.capOk ? "" : "text-danger"}>
        Max/dept {outlook.largest}/{MAX_PER_DEPARTMENT}
      </span>
    </>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function needsText(outlook: SquadOutlook) {
  const parts: string[] = [];
  if (outlook.womenNeeded > 0) parts.push(plural(outlook.womenNeeded, "woman", "women"));
  if (outlook.departmentsNeeded > 0) parts.push(plural(outlook.departmentsNeeded, "dept", "depts"));
  return parts.join(" + ");
}

/** One plain sentence for the desk: why this team is fine, tight, short, or blocked. */
function shortfallSentence(
  team: LivePayload["teams"][number],
  player: { name: string; department: string; gender: string } | null,
) {
  const { seatsToFill, now, ifWins } = team.projection;
  const seats = (count: number) => plural(count, "seat", "seats");
  const needNow = needsText(now);
  if (!now.capOk) return `Over the cap: ${now.largest} people from one department (max ${MAX_PER_DEPARTMENT}).`;
  if (now.womenShort > 0 || now.departmentsShort > 0) {
    return `Short now: needs ${needNow} with only ${seats(seatsToFill)} to fill.`;
  }
  if (!ifWins || !player) {
    return needNow ? `Needs ${needNow} with ${seats(seatsToFill)} to fill.` : "All set: women and departments met.";
  }
  const who = [player.gender, player.department].filter(Boolean).join(" ");
  const winning = `winning ${player.name}${who ? ` (${who})` : ""}`;
  if (!ifWins.capOk) {
    return `${player.department || "That department"} is at the cap of ${MAX_PER_DEPARTMENT}; ${winning} makes ${ifWins.largest}.`;
  }
  const needAfter = needsText(ifWins);
  if (!ifWins.ok) {
    return `Tight: needs ${needNow} with ${seats(seatsToFill)}; ${winning} leaves ${seats(ifWins.seatsAfter)} for ${needAfter}.`;
  }
  if (!needNow) return "All set: women and departments met.";
  return `Needs ${needNow} with ${seats(seatsToFill)}; ${winning} leaves ${seats(ifWins.seatsAfter)}${needAfter ? ` for ${needAfter}` : ", all met"}.`;
}

/** Always-on runway check: where the squad stands now, and what winning the current lot does to it. */
function Projection({
  team,
  player,
}: {
  team: LivePayload["teams"][number];
  player: { name: string; department: string; gender: string } | null;
}) {
  const { seatsToFill, now, ifWins } = team.projection;
  const playerName = player?.name ?? null;
  const trouble =
    !now.capOk || now.womenShort > 0 || now.departmentsShort > 0 || (ifWins != null && !ifWins.ok);
  return (
    <span className="mt-1 block text-xs leading-snug text-mist/70">
      <span className={`block ${trouble ? "text-danger" : "text-paper/80"}`}>{shortfallSentence(team, player)}</span>
      <span className="block">
        <span className="text-mist/50">Now · {seatsToFill} to fill · </span>
        <Outlook outlook={now} />
      </span>
      {ifWins ? (
        <span className="block">
          <span className="text-mist/50">
            If wins{playerName ? ` ${playerName}` : ""} · {ifWins.seatsAfter} left ·{" "}
          </span>
          <Outlook outlook={ifWins} />
          <span className={ifWins.ok ? "text-bid" : "font-semibold text-danger"}>
            {ifWins.ok ? " · OK" : " · BLOCKED"}
          </span>
        </span>
      ) : null}
    </span>
  );
}

export function AuctionConsole({ initial }: { initial: LivePayload }) {
  const [live, setLive] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, setPending] = useState(false);
  const [stampPulse, setStampPulse] = useState(0);
  const confirmedWarnings = useRef(new Set<string>());

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

  const blockPlayer = live.player
    ? {
      name: live.player.name,
      department: live.player.department,
      gender: memberFact(live.player.formAnswers).gender.trim(),
    }
    : null;
  const floor = nextBidFloor(live.state.currentAmount, live.player?.minBid);
  const step = raiseStep(live.state.currentAmount);
  const lotOpen = live.state.status === "open" && live.player;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!/^[1-8]$/.test(event.key)) return;
      const team = live.teams[Number(event.key) - 1];
      if (!team || !lotOpen || pending) return;
      if (team.seatsLeft <= 0 || outOfMoney(team.balance)) return;
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
    const problem = bidProblem(value, live.state.currentAmount, live.player?.minBid);
    if (problem) {
      setError(problem);
      return;
    }
    const warning = womenSupplyWarning(live, teamId);
    // Ask once per team per lot; later raises by the same team go straight through.
    const confirmKey = `${live.player?.id ?? ""}:${teamId}`;
    if (warning && !confirmedWarnings.current.has(confirmKey)) {
      if (!window.confirm(`${warning}\n\nPlace the bid anyway?`)) return;
      confirmedWarnings.current.add(confirmKey);
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
      <p className="text-sm text-mist/70">
        <span className="text-mist/50">Pool · </span>
        {live.waiting} waiting · {live.womenWaiting} {live.womenWaiting === 1 ? "woman" : "women"}
        {live.player?.department ? (
          <>
            <span className="text-mist/50"> · On block: </span>
            {live.player.department}
          </>
        ) : null}
        {live.departmentsWaiting.length > 0 ? (
          <>
            <span className="text-mist/50"> · </span>
            {live.departmentsWaiting.map((item) => `${item.name} ${item.count}`).join(" · ")}
          </>
        ) : null}
      </p>
      <div className="grid gap-2 lg:grid-cols-2">
        {live.teams.map((team, index) => {
          const current = live.state.currentTeamId === team.id && live.state.currentAmount != null;
          const amount = amountFor(team.id);
          const typed = drafts[team.id] ?? "";
          const full = team.seatsLeft <= 0;
          const spent = !full && outOfMoney(team.balance);
          const locked = full || spent;
          const overPurse = amount > (team.balance ?? 0);
          const who = team.captainName ?? "No captain";
          return (
            <div
              key={team.id}
              className={`flex items-center gap-2 border px-2 py-2 ${
                current ? "border-bid bg-hall-2" : "border-white/15"
              } ${locked ? "opacity-50" : ""}`}
            >
              <span className="w-6 shrink-0 text-center text-lg font-bold text-bid">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-semibold leading-tight text-paper">{who}</span>
                <span className={`block truncate text-xs ${(team.balance ?? 0) < 0 ? "text-danger" : "text-mist/70"}`}>
                  {formatLakhs(team.balance ?? 0)} left · {team.seatsLeft} seats · W{team.women.state === "ok" ? "✓" : team.women.state === "warn" ? "!" : ""} T{team.cross.state === "ok" ? "✓" : team.cross.state === "warn" ? "!" : ""}
                  {spent ? " · purse spent, assign after auction" : full ? " · squad full" : overPurse ? " · over purse" : ""}
                </span>
                <Projection team={team} player={blockPlayer} />
              </span>
              <button
                type="button"
                className="btn btn-step btn-purple"
                aria-label={`Lower the bid for ${who}`}
                disabled={pending || !lotOpen || locked || amount <= floor}
                onClick={() => bump(team.id, -1)}
              >
                -
              </button>
              <button
                type="button"
                className="btn btn-cyan min-w-32 px-3"
                disabled={pending || !lotOpen || locked}
                onClick={() => place(team.id)}
              >
                {formatMoney(amount)}
              </button>
              <button
                type="button"
                className="btn btn-step btn-cyan"
                aria-label={`Raise the bid for ${who}`}
                disabled={pending || !lotOpen || locked}
                onClick={() => bump(team.id, 1)}
              >
                +
              </button>
              <input
                inputMode="numeric"
                aria-label={`Custom bid for ${who}`}
                value={typed}
                placeholder={String(floor)}
                disabled={pending || !lotOpen || locked}
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
