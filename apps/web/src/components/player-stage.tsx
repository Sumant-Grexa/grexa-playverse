"use client";

import { useState } from "react";
import { formatLakhs, formatMoney, monogram } from "@/lib/format";
import type { LivePayload } from "@/lib/types";

export function PlayerStage({ live }: { live: LivePayload }) {
  const motionKey = live.player?.id ?? "empty";
  const notice = live.notice;
  const shownAmount = notice?.amount ?? live.state.currentAmount;
  const shownCaptain = notice?.captainName ?? live.state.currentCaptainName;
  const tape = live.tape.slice(0, 2);

  return (
    <section className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:gap-8 xl:gap-10">
      <article
        key={motionKey}
        className="card-arrive player-card arcade-panel arcade-panel-cyan flex min-h-[420px] min-w-0 flex-col overflow-hidden"
      >
        {live.player ? (
          <>
            <div className="grid flex-1 gap-5 p-5 sm:grid-cols-[minmax(160px,240px)_minmax(0,1fr)] sm:p-6">
              <div className="relative">
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-hall text-paper">
                  {live.player.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={live.player.photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-display text-5xl text-bid">{monogram(live.player.name)}</span>
                  )}
                </div>
                {live.player.badge ? (
                  <span className="player-badge">{live.player.badge}</span>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-col justify-between gap-6">
                <div>
                  <h1 className="font-sans text-4xl font-semibold leading-none tracking-tight text-paper sm:text-5xl">
                    {live.player.name}
                  </h1>
                  <p className="pixel-label mt-5 text-bid">Skills</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {live.player.skills.length === 0 ? (
                      <span className="text-mist/60">No skills listed</span>
                    ) : (
                      live.player.skills.map((skill) => (
                        <span key={skill} className="skill-chip">
                          {skill}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-lg text-mist/80">{shownCaptain ?? "No bid yet"}</p>
                  <p className={`bid-card-figure mt-1 ${notice ? "text-danger" : ""}`}>
                    {shownAmount == null ? "—" : formatMoney(shownAmount)}
                  </p>
                </div>
              </div>
            </div>
            <ul className="border-t border-white/10 px-5 py-4 sm:px-6">
              {tape.length === 0 ? (
                <li className="text-mist/60">No bids yet</li>
              ) : (
                tape.map((bid) => (
                  <li key={bid.id} className="flex items-center gap-3 py-2">
                    <Face name={bid.captainName} photoUrl={bid.captainPhotoUrl} />
                    <span className="font-sans text-2xl font-extrabold text-paper">{formatMoney(bid.amount)}</span>
                  </li>
                ))
              )}
            </ul>
          </>
        ) : (
          <div className="flex flex-1 flex-col justify-end p-6">
            <p className="pixel-label text-bid">Auction</p>
            <h1 className="mt-3 font-sans text-4xl font-semibold text-paper">The block is empty</h1>
            <p className="mt-4 text-lg text-mist/80">
              {live.tournament
                ? `${live.waiting} ${live.waiting === 1 ? "player is" : "players are"} still waiting.`
                : "Make a tournament live, then import the settled roster."}
            </p>
          </div>
        )}
      </article>

      <aside key={`bid-${motionKey}`} className="bid-arrive bid-stage arcade-panel flex min-h-[420px] min-w-0 flex-col overflow-hidden p-5 lg:p-6">
        <p className="text-sm font-semibold tracking-wide text-mist/80">Max bid</p>
        <p className="mt-2 truncate text-base text-paper sm:text-lg">
          {live.player?.name ?? "No player"}
          <span className="text-mist/50"> | </span>
          {shownCaptain ? `${shownCaptain}'s team` : "Waiting for a bid"}
        </p>
        <p className={`bid-stage-figure mt-3 ${notice ? "text-danger" : ""}`}>
          {shownAmount == null ? "—" : formatMoney(shownAmount)}
        </p>
        <div className="max-bid-split" aria-hidden="true" />
        <div className="flex flex-1 flex-col">
          {live.teams.map((team) => {
            const leading = live.state.currentTeamId === team.id && live.state.currentAmount != null;
            return (
              <div
                key={team.id}
                className={`flex items-center gap-3 border-b border-white/10 py-6 last:border-b-0 ${
                  leading ? "bg-hall-2/80" : ""
                }`}
              >
                <Face name={team.captainName ?? "No captain"} photoUrl={team.captainPhotoUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold text-paper">
                    {team.captainName ?? "No captain"}
                  </span>
                  <span className="block text-sm text-mist/70">Remaining: {formatLakhs(team.balance ?? 0)}</span>
                </span>
                <RuleDot letter="W" state={team.women.state} label={team.women.label} />
                <RuleDot letter="T" state={team.cross.state} label={team.cross.label} />
              </div>
            );
          })}
        </div>
      </aside>
    </section>
  );
}

function Face({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  return (
    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-hall text-sm font-bold text-bid">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        monogram(name)
      )}
    </span>
  );
}

function RuleDot({
  letter,
  state,
  label,
}: {
  letter: string;
  state: "idle" | "ok" | "warn";
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        type="button"
        className={`rule-dot rule-dot-${state}`}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
      >
        {state === "ok" ? "✓" : state === "warn" ? "!" : letter}
      </button>
      {open ? <span className="rule-tip">{label}</span> : null}
    </span>
  );
}
