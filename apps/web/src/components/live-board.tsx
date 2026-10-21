"use client";

import { useEffect, useState } from "react";
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

  return (
    <div className="flex w-full justify-center px-4 py-6">
      <div className="flex items-start gap-12 sm:gap-20">
        <p className="brand-stack text-bid" aria-label="Grexa Playverse">
          {["GREXA", "PLAYVERSE"].map((word) => (
            <span key={word} className="brand-word" aria-hidden="true">
              {word.split("").map((letter, index) => (
                <span key={`${word}-${index}`}>{letter}</span>
              ))}
            </span>
          ))}
        </p>
        <PlayerStage live={live} />
      </div>
    </div>
  );
}
