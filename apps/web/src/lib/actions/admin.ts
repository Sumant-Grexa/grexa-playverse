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
import { finalizeBid, markUnsold, placeBid, resetTestAuction } from "../auction";
import { createGame, saveGame } from "../games";
import {
  addSquadMember,
  createTeam,
  importSettledCsv,
  reassignCaptain,
  removeSquadMember,
  savePlaceholders,
  savePlayerPhoto,
  updateTeam,
} from "../roster";
import type { ActionResult } from "../types";

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
  revalidatePath("/teams");
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
    const result = await importSettledCsv({
      tournamentId,
      csvText: await file.text(),
    });
    refresh();
    const { saved, failed } = result.photos;
    let photos = saved ? ` Saved ${saved} photos from Google Drive.` : "";
    if (failed.length) {
      const names = failed.slice(0, 5).join(", ") + (failed.length > 5 ? ", …" : "");
      photos +=
        ` ${failed.length} photos could not be downloaded (${names}).` +
        " Share the Drive folder as “Anyone with the link can view” and import again.";
    }
    return {
      ok: true,
      message: `Imported ${result.people} people. Teams stay as they are.${photos}`,
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

export async function createTeamAction(formData: FormData) {
  await assertAdmin();
  const tournamentId = String(formData.get("tournamentId") ?? "");
  const captainName = String(formData.get("captainName") ?? "");
  const file = formData.get("photo");
  const photo =
    file instanceof File && file.size > 0
      ? { filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) }
      : undefined;
  try {
    await createTeam({
      tournamentId,
      captainName,
      photo,
      captain: {
        gender: String(formData.get("captainGender") ?? ""),
        department: String(formData.get("captainDepartment") ?? ""),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the team";
    redirect(`/admin/tournament?error=${encodeURIComponent(message)}`);
  }
  refresh();
  redirect(`/admin/tournament?tournament=${encodeURIComponent(tournamentId)}`);
}

export async function updateTeamAction(formData: FormData): Promise<ActionResult> {
  try {
    await assertAdmin();
    const file = formData.get("logo");
    const logo =
      file instanceof File && file.size > 0
        ? { filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) }
        : undefined;
    const captainFile = formData.get("captainPhoto");
    const captainPhoto =
      captainFile instanceof File && captainFile.size > 0
        ? { filename: captainFile.name, bytes: Buffer.from(await captainFile.arrayBuffer()) }
        : undefined;
    await updateTeam({
      tournamentId: String(formData.get("tournamentId") ?? ""),
      teamId: String(formData.get("teamId") ?? ""),
      name: String(formData.get("name") ?? ""),
      logo,
      captainPhoto,
      captain: {
        gender: String(formData.get("captainGender") ?? ""),
        department: String(formData.get("captainDepartment") ?? ""),
      },
    });
    refresh();
    return { ok: true, message: "Team saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function addPlayerAction(formData: FormData): Promise<ActionResult> {
  try {
    await assertAdmin();
    await addSquadMember({
      tournamentId: String(formData.get("tournamentId") ?? ""),
      teamId: String(formData.get("teamId") ?? ""),
      tournamentPlayerId: String(formData.get("tournamentPlayerId") ?? ""),
    });
    refresh();
    return { ok: true, message: "Player added to the squad." };
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
    return { ok: true, message: "Saved. Bids still follow the fixed purse and increment rules." };
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
    if (error instanceof Error && error.name === "AuctionBuzzError") {
      refresh();
      return { ok: false, error: error.message, buzz: true };
    }
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

export async function resetTestAuctionAction(): Promise<ActionResult> {
  try {
    await assertAdmin();
    const playerName = await resetTestAuction();
    refresh();
    return {
      ok: true,
      message: playerName ? `${playerName} is up.` : "Reset. No player is waiting.",
    };
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
