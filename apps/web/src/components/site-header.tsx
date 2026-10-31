"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/admin";

const publicLinks = [
  ["/board", "Auction"],
  ["/teams", "Teams"],
  ["/leaderboard", "Leaderboard"],
];

const adminLinks = [
  ["/admin", "Auction"],
  ["/admin/tournament", "Roster"],
  ["/admin/leaderboard", "Scores"],
];

export function SiteHeader({
  tournamentName,
  mode,
}: {
  tournamentName: string | null;
  mode: "public" | "admin";
}) {
  const pathname = usePathname();
  const links = mode === "admin" ? adminLinks : publicLinks;

  return (
    <header className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-5">
      <Link href={mode === "admin" ? "/admin" : "/board"} className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.png" alt="Grexa Playverse" className="h-16 w-auto sm:h-20" />
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold tracking-wide text-gold">
          {tournamentName ?? "No live tournament"}
        </p>
        <nav className="flex flex-wrap items-center gap-2">
          {links.map(([href, label]) => {
            const current = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                className={current ? "nav-link nav-link-current" : "nav-link"}
                aria-current={current ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
          {mode === "admin" ? (
            <form action={logout}>
              <button type="submit" className="nav-link">
                Log out
              </button>
            </form>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
