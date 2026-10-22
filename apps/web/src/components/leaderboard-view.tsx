"use client";

import { useEffect, useState } from "react";
import { formatWhen } from "@/lib/format";
import type { LeaderboardPayload } from "@/lib/types";

function Bar({ value, scale }: { value: number; scale: number }) {
  const width = Math.max(0, Math.min(100, (value / Math.max(scale, value, 1)) * 100));
  return (
    <div className="h-3 overflow-hidden rounded-full bg-hall">
      <div
        className="score-bar h-full rounded-full"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function LeaderboardView({ initial }: { initial: LeaderboardPayload }) {
  const [board, setBoard] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch("/api/leaderboard", { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as LeaderboardPayload;
        if (!cancelled) setBoard(next);
      } catch {
        // Keep the last board.
      }
    }
    const timer = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const ranked = [...board.totals].sort((a, b) => b.total - a.total);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 pb-12">
      <section className="arcade-panel p-6">
        <h1 className="pixel-label text-bid">Leaderboard</h1>
        {ranked.length === 0 ? (
          <p className="mt-4 text-mist/70">Teams show up here after the roster is imported.</p>
        ) : (
          <ol className="mt-6 space-y-4">
            {ranked.map((team) => (
              <li key={team.teamId}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="text-xl text-paper">{team.teamName}</span>
                  <span className={`font-sans text-3xl font-semibold ${team.total < 0 ? "text-danger" : "text-gold"}`}>
                    {team.total}
                  </span>
                </div>
                {team.squadGap < 0 ? (
                  <p className="mb-2 text-sm text-mist/70">Squad gap {team.squadGap}</p>
                ) : null}
                {team.total > 0 ? <Bar value={team.total} scale={board.scale} /> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {board.games.length === 0 ? (
        <p className="text-mist/70">No games yet.</p>
      ) : (
        board.games.map((game) => (
          <section key={game.id} className="arcade-panel arcade-panel-cyan p-6">
            <h2 className="font-sans text-3xl font-semibold text-paper">{game.name}</h2>
            <p className="mt-2 text-sm text-mist/70">
              {formatWhen(game.startedOn)}
              {game.endedOn ? ` to ${formatWhen(game.endedOn)}` : ""}
              {" · "}max {game.maxScore}
            </p>
            <ol className="mt-5 space-y-4">
              {game.rows.map((row) => (
                <li key={row.standingId}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span>{row.teamName}</span>
                    <span className="font-sans text-2xl font-semibold text-gold">{row.total}</span>
                  </div>
                  <Bar value={row.total} scale={Math.max(game.maxScore, row.total, 1)} />
                  <p className="mt-1 text-sm text-mist/70">
                    Score {row.score}
                    {row.brownies.length
                      ? ` · ${row.brownies.map((brownie) => `${brownie.name} ${brownie.value}`).join(", ")}`
                      : ""}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
