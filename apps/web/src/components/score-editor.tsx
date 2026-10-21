"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createGameAction, saveGameAction } from "@/lib/actions/admin";
import { formatWhen } from "@/lib/format";
import type { LeaderboardPayload } from "@/lib/types";

type DraftBrownie = { key: string; name: string; value: string };

export function ScoreEditor({ initial }: { initial: LeaderboardPayload }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftBrownie[]>>(() => {
    const next: Record<string, DraftBrownie[]> = {};
    for (const game of initial.games) {
      for (const row of game.rows) {
        next[row.standingId] = row.brownies.map((brownie) => ({
          key: brownie.id,
          name: brownie.name,
          value: String(brownie.value),
        }));
      }
    }
    return next;
  });

  async function run(task: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setPending(true);
    const result = await task();
    setPending(false);
    setMessage(result.ok ? (result.message ?? "Saved.") : (result.error ?? "Could not save"));
    if (result.ok) router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-8 px-4 pb-16">
      <form
        className="arcade-panel p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => createGameAction(new FormData(event.currentTarget)));
        }}
      >
        <h1 className="pixel-label text-bid">Scores</h1>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label>
            Game name
            <input name="name" required className="field" />
          </label>
          <label>
            Max score
            <input name="maxScore" required inputMode="numeric" className="field" />
          </label>
          <label>
            Started
            <input name="startedOn" type="datetime-local" required className="field" />
          </label>
          <label>
            Ended
            <input name="endedOn" type="datetime-local" className="field" />
          </label>
        </div>
        <button type="submit" disabled={pending} className="btn btn-cyan mt-4">
          Add game
        </button>
      </form>

      {message ? <p className="text-gold">{message}</p> : null}

      {initial.games.map((game) => (
        <form
          key={game.id}
          className="arcade-panel arcade-panel-cyan p-6"
          onSubmit={(event) => {
            event.preventDefault();
            const scores = game.rows.map((row) => {
              const field = new FormData(event.currentTarget).get(`score-${row.standingId}`);
              return { standingId: row.standingId, score: Number(field) };
            });
            const brownies = game.rows.flatMap((row) =>
              (drafts[row.standingId] ?? [])
                .filter((brownie) => brownie.name.trim())
                .map((brownie) => ({
                  standingId: row.standingId,
                  name: brownie.name,
                  value: Number(brownie.value),
                })),
            );
            void run(() => saveGameAction({ gameId: game.id, scores, brownies }));
          }}
        >
          <h2 className="font-sans text-3xl font-semibold text-paper">{game.name}</h2>
          <p className="mt-2 text-sm text-mist/70">
            {formatWhen(game.startedOn)} · max {game.maxScore}. Brownie names are free text.
          </p>
          <div className="mt-4 space-y-5">
            {game.rows.map((row) => (
              <fieldset key={row.standingId} className="rounded-2xl border border-bid/30 p-4">
                <legend className="px-2">{row.teamName}</legend>
                <label className="block max-w-xs">
                  Score
                  <input
                    name={`score-${row.standingId}`}
                    defaultValue={row.score}
                    inputMode="numeric"
                    className="field"
                  />
                </label>
                <div className="mt-3 space-y-2">
                  {(drafts[row.standingId] ?? []).map((brownie) => (
                    <div key={brownie.key} className="flex gap-2">
                      <input
                        value={brownie.name}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [row.standingId]: (current[row.standingId] ?? []).map((item) =>
                              item.key === brownie.key ? { ...item, name: event.target.value } : item,
                            ),
                          }))
                        }
                        placeholder="Brownie name"
                        className="field"
                      />
                      <input
                        value={brownie.value}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [row.standingId]: (current[row.standingId] ?? []).map((item) =>
                              item.key === brownie.key ? { ...item, value: event.target.value } : item,
                            ),
                          }))
                        }
                        inputMode="numeric"
                        className="field w-24"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() =>
                      setDrafts((current) => ({
                        ...current,
                        [row.standingId]: [
                          ...(current[row.standingId] ?? []),
                          { key: crypto.randomUUID(), name: "", value: "0" },
                        ],
                      }))
                    }
                  >
                    Add brownie
                  </button>
                </div>
              </fieldset>
            ))}
          </div>
          <button type="submit" disabled={pending} className="btn btn-gold mt-4">
            Save scores
          </button>
        </form>
      ))}
    </div>
  );
}
