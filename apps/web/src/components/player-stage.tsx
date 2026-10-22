import { formatMoney, labelize, monogram } from "@/lib/format";
import { bidStep, MIN_BID } from "@/lib/rules";
import type { LivePayload } from "@/lib/types";

export function PlayerStage({ live }: { live: LivePayload }) {
  const answers = Object.entries(live.player?.formAnswers ?? {}).slice(0, 12);
  const captain = Boolean(live.player?.captainOf);

  return (
    <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:gap-16 xl:gap-24">
      <article className={`overflow-hidden lg:order-2 ${captain ? "arcade-panel" : "arcade-panel arcade-panel-cyan"}`}>
        {live.player ? (
          <div className="flex flex-col">
            <div className="flex aspect-[3/4] items-center justify-center bg-hall text-paper">
              {live.player.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={live.player.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-display text-5xl text-bid">{monogram(live.player.name)}</span>
              )}
            </div>
            <div className="flex flex-col gap-4 p-5">
              <p className={`chip w-fit px-3 py-1 ${captain ? "" : "chip-cyan"}`}>
                {captain ? "Captain" : "Player"}
              </p>
              <h1 className="font-sans text-4xl font-semibold leading-none tracking-tight text-paper">
                {live.player.name}
              </h1>
              {live.player.captainOf ? (
                <p className="text-gold">Captain of {live.player.captainOf}</p>
              ) : null}
              {live.player.lastSeason ? (
                <p className="text-base leading-6 text-mist">
                  Last season, {live.player.lastSeason.teamName} bid{" "}
                  {formatMoney(live.player.lastSeason.amount)}
                  {live.player.lastSeason.refunded ? ", later refunded" : ""}.
                </p>
              ) : null}
              {answers.length > 0 ? (
                <div>
                  <h2 className="pixel-label text-bid">Skills</h2>
                  <dl className="mt-3 grid gap-3">
                    {answers.map(([key, value]) => (
                      <div key={key}>
                        <dt className="pixel-label text-bid/80">{labelize(key)}</dt>
                        <dd className="text-lg text-paper">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex aspect-[3/4] flex-col justify-end p-6">
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

      <aside className="bid-stage arcade-panel flex flex-col p-8 lg:order-1 lg:p-12">
        <p className="pixel-label text-gold">Current bid</p>
        <p className="bid-stage-figure mt-6 whitespace-nowrap">
          {live.state.currentAmount == null ? "—" : formatMoney(live.state.currentAmount)}
        </p>
        <p className="mt-8 text-3xl text-paper">{live.state.currentTeamName ?? "No team has bid"}</p>
        <p className="mt-5 max-w-xl text-lg leading-7 text-mist/70">
          {live.state.currentAmount == null || live.state.currentAmount <= 0
            ? `Opens at ${formatMoney(MIN_BID)}, then steps of ${formatMoney(50_000)}`
            : `Next bid ${formatMoney(live.state.currentAmount + bidStep(live.state.currentAmount))} · steps of ${formatMoney(bidStep(live.state.currentAmount))}`}
        </p>
        <h2 className="pixel-label mt-12 text-bid">Bids for this player</h2>
        {live.tape.length === 0 ? (
          <p className="mt-3 text-mist/70">No bids yet.</p>
        ) : (
          <ol className="mt-3 divide-y divide-white/10">
            {live.tape.map((bid) => (
              <li key={bid.id} className="flex items-center justify-between gap-3 py-3">
                <span className="flex items-center gap-3 text-paper">
                  {bid.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bid.logoUrl} alt="" className="h-8 w-8 rounded-full bg-hall object-cover" />
                  ) : null}
                  {bid.teamName}
                </span>
                <span className="font-sans text-xl font-semibold text-gold">{formatMoney(bid.amount)}</span>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </section>
  );
}
