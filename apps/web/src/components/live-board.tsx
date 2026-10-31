"use client";

import { useEffect, useRef, useState } from "react";
import { ClosingShow } from "@/components/closing-show";
import { PlayerStage } from "@/components/player-stage";
import { SoldStamp } from "@/components/sold-stamp";
import { playBuzzSound, primeSoldSound } from "@/lib/sold-sound";
import type { LivePayload } from "@/lib/types";

export function LiveBoard({ initial }: { initial: LivePayload }) {
  const [live, setLive] = useState(initial);
  const seenNotice = useRef<string | null | undefined>(undefined);

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

  useEffect(() => {
    const id = live.notice?.id ?? null;
    if (seenNotice.current === undefined) {
      seenNotice.current = id;
      return;
    }
    if (!id || seenNotice.current === id) return;
    seenNotice.current = id;
    playBuzzSound();
  }, [live.notice?.id]);

  if (live.ceremony) {
    return <ClosingShow teams={live.ceremony.teams} />;
  }

  return (
    <div
      className="flex w-full items-start gap-3 px-3 py-6 sm:gap-4 sm:px-4 lg:gap-6 lg:px-6 lg:py-8"
      onPointerDown={primeSoldSound}
    >
      <SoldStamp saleId={live.marks.saleId} />
      {live.notice ? <p className="rule-notice">{live.notice.message}</p> : null}
      <div className="flex shrink-0 flex-col items-center gap-3 lg:gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.png" alt="" className="w-14 sm:w-24 lg:w-28" />
      <p className="brand-stack text-bid" aria-label="Grexa Playverse">
        {["GREXA", "PLAYVERSE"].map((word) => (
          <span key={word} className="brand-word" aria-hidden="true">
            {word.split("").map((letter, index) => (
              <span key={`${word}-${index}`}>{letter}</span>
            ))}
          </span>
        ))}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <PlayerStage live={live} />
      </div>
    </div>
  );
}
