"use client";

import { useEffect, useState } from "react";
import type { LivePayload } from "@/lib/types";

type CeremonyTeam = NonNullable<LivePayload["ceremony"]>["teams"][number];

type Palette = {
  background: string;
  card: string;
  accent: string;
  ink: string;
  plate: string;
};

const FALLBACK: Palette = {
  background: "linear-gradient(160deg, #7d2ae7, #4a4fee 55%, #00d9e3)",
  card: "rgba(7, 3, 24, 0.9)",
  accent: "#00d9e3",
  ink: "#f6f3ff",
  plate: "rgba(7, 3, 24, 0.88)",
};

const TEAM_HOLD_MS = 15000;
const ROW_MS = 160;
const INTRO_MS = 2400;

export function ClosingShow({ teams }: { teams: CeremonyTeam[] }) {
  const [phase, setPhase] = useState<"intro" | "team" | "thanks">(teams.length ? "intro" : "thanks");
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const team = teams[index];
  const activeId = team?.id ?? "";
  const activeCount = team?.players.length ?? 0;
  const palette = useLogoPalette(phase === "team" ? (team?.logoUrl ?? null) : null);

  useEffect(() => {
    if (phase !== "intro") return;
    const timer = window.setTimeout(() => setPhase("team"), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "team" || !activeId) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setShown(reduce ? activeCount : 0);
    const rows = reduce
      ? 0
      : window.setInterval(() => {
          setShown((count) => (count >= activeCount ? count : count + 1));
        }, ROW_MS);
    const hold = window.setTimeout(() => {
      setIndex((current) => {
        if (current + 1 >= teams.length) {
          setPhase("thanks");
          return current;
        }
        return current + 1;
      });
    }, TEAM_HOLD_MS);
    return () => {
      if (rows) window.clearInterval(rows);
      window.clearTimeout(hold);
    };
  }, [phase, activeId, activeCount, teams.length]);

  if (phase === "intro") {
    return (
      <div className="closing-screen closing-intro">
        <div>
          <p className="pixel-label text-gold">Bid closed</p>
          <p className="bid-burst-word">Sold</p>
        </div>
      </div>
    );
  }

  if (phase === "thanks" || !team) {
    return (
      <div className="closing-screen closing-thanks">
        <div>
          <h1 className="thanks-title">Thanks</h1>
          <p className="thanks-line">Auction is over</p>
        </div>
      </div>
    );
  }

  const colors = palette ?? FALLBACK;

  return (
    <div className="closing-screen" style={{ background: colors.background, color: colors.ink }}>
      <article key={team.id} className="team-card" style={{ background: colors.card }}>
        <div className="team-card-names">
          <ul>
            {team.players.slice(0, shown).map((name, row) => (
              <li key={`${team.id}-${row}`} className="team-row">
                {name}
              </li>
            ))}
          </ul>
        </div>
        <div className="team-card-captain">
          <div className="captain-photo">
            {team.captainPhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.captainPhotoUrl} alt="" />
            ) : (
              <CaptainSilhouette />
            )}
          </div>
          <div
            className="captain-plate"
            style={{ borderColor: colors.accent, background: colors.plate, color: colors.ink }}
          >
            <strong>{team.captainName ?? "Captain"}</strong>
            <span>{team.name}</span>
          </div>
        </div>
      </article>
    </div>
  );
}

function useLogoPalette(logoUrl: string | null) {
  const [palette, setPalette] = useState<Palette | null>(null);

  useEffect(() => {
    if (!logoUrl) {
      setPalette(null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setPalette(readPalette(image));
    };
    image.onerror = () => {
      if (!cancelled) setPalette(null);
    };
    image.src = logoUrl;
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  return palette;
}

function readPalette(image: HTMLImageElement): Palette {
  const canvas = document.createElement("canvas");
  const size = 40;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return FALLBACK;
  context.drawImage(image, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] ?? 0;
    if (alpha < 80) continue;
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    const key = `${red >> 4},${green >> 4},${blue >> 4}`;
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += red;
    bucket.g += green;
    bucket.b += blue;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .map((bucket) => ({
      n: bucket.n,
      r: Math.round(bucket.r / bucket.n),
      g: Math.round(bucket.g / bucket.n),
      b: Math.round(bucket.b / bucket.n),
    }))
    .sort((left, right) => right.n - left.n);
  const background = ranked[0];
  if (!background) return FALLBACK;
  const accent =
    ranked.find((color) => distance(color, background) > 48) ?? ranked[1] ?? background;
  const luma = (0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b) / 255;
  const ink = luma > 0.62 ? "#141028" : "#f7f4ff";
  const card = luma > 0.62 ? "rgba(255, 255, 255, 0.94)" : "rgba(10, 8, 24, 0.9)";
  return {
    background: `linear-gradient(155deg, ${rgb(background)} 0%, ${rgb(mix(background, accent, 0.45))} 100%)`,
    card,
    accent: rgb(accent),
    ink,
    plate: card,
  };
}

function distance(
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number },
) {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
}

function mix(
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number },
  amount: number,
) {
  return {
    r: Math.round(left.r + (right.r - left.r) * amount),
    g: Math.round(left.g + (right.g - left.g) * amount),
    b: Math.round(left.b + (right.b - left.b) * amount),
  };
}

function rgb(color: { r: number; g: number; b: number }) {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

function CaptainSilhouette() {
  return (
    <svg className="captain-silhouette" viewBox="0 0 200 260" aria-hidden="true">
      <path
        fill="currentColor"
        fillOpacity="0.28"
        d="M100 18c28 0 48 22 48 50s-18 52-48 52-48-22-48-52 20-50 48-50zm-62 214c6-52 32-84 62-84s56 32 62 84c2 14-8 18-20 18H58c-12 0-22-4-20-18z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        d="M100 22c26 0 44 20 44 46s-16 48-44 48-44-20-44-48 18-46 44-46zm-56 206c6-48 30-78 56-78s50 30 56 78"
      />
    </svg>
  );
}
