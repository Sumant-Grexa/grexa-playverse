"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { tournaments, getDb } from "@playverse/db";
import { eq } from "drizzle-orm";
import {
  createSessionToken,
  passwordMatches,
  SESSION_COOKIE,
  verifySessionToken,
} from "../auth";
import { bringNextPlayer, finalizeBid, markUnsold, placeBid } from "../auction";
import { createGame, saveGame } from "../games";
import {
  importSettledCsv,
  reassignCaptain,
  removeSquadMember,
  savePlaceholders,
  savePlayerPhoto,
} from "../roster";
import type { ActionResult } from "../types";
import { safeName } from "../uploads";

async function assertAdmin() {
  const jar = await cookies();
  const ok = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!ok) throw new Error("Admin sign-in required");
}

function fail(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : "Something went wrong" };
}

function refresh() {
  revalidatePath("/board");
  revalidatePath("/leaderboard");
  revalidatePath("/admin");
  revalidatePath("/admin/tournament");
  revalidatePath("/admin/leaderboard");
}

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!passwordMatches(password)) {
    redirect("/admin/login?error=1");
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect("/admin");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/admin/login");
}

export async function createTournament(formData: FormData) {
  await assertAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin/tournament?error=Name+the+tournament");
  const db = getDb();
  const existing = await db.select({ id: tournaments.id }).from(tournaments);
  const [created] = await db
    .insert(tournaments)
    .values({ name, status: existing.length === 0 ? "active" : "draft" })
    .returning();
  refresh();
  redirect(`/admin/tournament?tournament=${created.id}`);
}

export async function activateTournament(formData: FormData) {
  await assertAdmin();
  const id = String(formData.get("tournamentId") ?? "");
  const db = getDb();
  await db.update(tournaments).set({ status: "archived" }).where(eq(tournaments.status, "active"));
  await db.update(tournaments).set({ status: "active" }).where(eq(tournaments.id, id));
  refresh();
}

export async function importRoster(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await assertAdmin();
    const tournamentId = String(formData.get("tournamentId") ?? "");
    const file = formData.get("csv");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose the settled CSV" };
    }
    const logos = new Map<string, Buffer>();
    for (const entry of formData.getAll("logos")) {
      if (!(entry instanceof File) || entry.size === 0) continue;
      const bytes = Buffer.from(await entry.arrayBuffer());
      logos.set(entry.name, bytes);
      logos.set(safeName(entry.name), bytes);
    }
    const result = await importSettledCsv({
      tournamentId,
      csvText: await file.text(),
      logos,
    });
    refresh();
    return {
      ok: true,
      message: `Imported ${result.people} people and ${result.teams} empty teams.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function uploadPhoto(formData: FormData) {
  await assertAdmin();
  const tournamentId = String(formData.get("tournamentId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return;
  await savePlayerPhoto({
    tournamentId,
    personId,
    filename: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
  });
  refresh();
}

export async function reassignCaptainAction(formData: FormData): Promise<ActionResult> {
  try {
    await assertAdmin();
    await reassignCaptain({
      tournamentId: String(formData.get("tournamentId") ?? ""),
      teamId: String(formData.get("teamId") ?? ""),
      personId: String(formData.get("personId") ?? ""),
    });
    refresh();
    return { ok: true, message: "Captain updated." };
  } catch (error) {
    return fail(error);
  }
}

export async function removePlayerAction(formData: FormData): Promise<ActionResult> {
  try {
    await assertAdmin();
    await removeSquadMember({
      tournamentId: String(formData.get("tournamentId") ?? ""),
      teamId: String(formData.get("teamId") ?? ""),
      tournamentPlayerId: String(formData.get("tournamentPlayerId") ?? ""),
    });
    refresh();
    return { ok: true, message: "Player removed and the bid was returned." };
  } catch (error) {
    return fail(error);
  }
}

export async function savePlaceholdersAction(formData: FormData): Promise<ActionResult> {
  try {
    await assertAdmin();
    const tournamentId = String(formData.get("tournamentId") ?? "");
    const readOptional = (key: string) => {
      const text = String(formData.get(key) ?? "").trim();
      if (!text) return null;
      if (!/^-?\d+$/.test(text)) throw new Error(`${key} needs to be a whole number or blank`);
      return Number(text);
    };
    const teamIds = formData.getAll("penaltyTeamId").map(String);
    const penaltyValues = formData.getAll("penaltyValue").map(String);
    const penalties = teamIds.map((teamId, index) => {
      const text = (penaltyValues[index] ?? "").trim();
      if (!text) return { teamId, penalty: null };
      if (!/^-?\d+$/.test(text)) throw new Error("Penalty needs to be a whole number or blank");
      return { teamId, penalty: Number(text) };
    });
    const previous = String(formData.get("previousTournamentId") ?? "").trim();
    await savePlaceholders({
      tournamentId,
      previousTournamentId: previous || null,
      minBid: readOptional("minBid"),
      maxBid: readOptional("maxBid"),
      bidJump: readOptional("bidJump"),
      penalties,
    });
    refresh();
    return { ok: true, message: "Placeholders saved. They are not applied to bids or the purse." };
  } catch (error) {
    return fail(error);
  }
}

export async function placeBidAction(teamId: string, amount: number): Promise<ActionResult> {
  try {
    await assertAdmin();
    await placeBid(teamId, amount);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function finalizeBidAction(): Promise<ActionResult> {
  try {
    await assertAdmin();
    await finalizeBid();
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function unsoldAction(): Promise<ActionResult> {
  try {
    await assertAdmin();
    await markUnsold();
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function nextPlayerAction(): Promise<ActionResult> {
  try {
    await assertAdmin();
    const name = await bringNextPlayer();
    refresh();
    return { ok: true, message: name ? `${name} is on the block.` : "No players left in the pool." };
  } catch (error) {
    return fail(error);
  }
}

export async function createGameAction(formData: FormData): Promise<ActionResult> {
  try {
    await assertAdmin();
    const endedRaw = String(formData.get("endedOn") ?? "").trim();
    await createGame({
      name: String(formData.get("name") ?? ""),
      startedOn: new Date(String(formData.get("startedOn") ?? "")),
      endedOn: endedRaw ? new Date(endedRaw) : null,
      maxScore: Number(formData.get("maxScore")),
    });
    refresh();
    return { ok: true, message: "Game added." };
  } catch (error) {
    return fail(error);
  }
}

export async function saveGameAction(input: {
  gameId: string;
  scores: { standingId: string; score: number }[];
  brownies: { standingId: string; name: string; value: number }[];
}): Promise<ActionResult> {
  try {
    await assertAdmin();
    await saveGame(input);
    refresh();
    return { ok: true, message: "Scores saved." };
  } catch (error) {
    return fail(error);
  }
}
