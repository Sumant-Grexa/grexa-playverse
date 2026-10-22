"use client";

import { useEffect, useState } from "react";
import { ClosingShow } from "@/components/closing-show";
import { PlayerStage } from "@/components/player-stage";
import type { LivePayload } from "@/lib/types";

export function LiveBoard({ initial }: { initial: LivePayload }) {
  const [live, setLive] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch("/api/live", { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as LivePayload;
        if (!cancelled) setLive(next);
      } catch {
        // The next poll retries. A missed second should not blank the projector.
      }
    }
    const timer = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (live.ceremony) {
    return <ClosingShow teams={live.ceremony.teams} />;
  }

  return (
    <div className="flex w-full items-start gap-10 px-4 py-8 sm:gap-14 lg:gap-20 lg:px-8">
      <p className="brand-stack shrink-0 text-bid" aria-label="Grexa Playverse">
        {["GREXA", "PLAYVERSE"].map((word) => (
          <span key={word} className="brand-word" aria-hidden="true">
            {word.split("").map((letter, index) => (
              <span key={`${word}-${index}`}>{letter}</span>
            ))}
          </span>
        ))}
      </p>
      <div className="min-w-0 flex-1">
        <PlayerStage live={live} />
      </div>
    </div>
  );
}
