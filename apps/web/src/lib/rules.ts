import { formatMoney } from "./format";

export const LAKH = 100_000;
export const CRORE = 100 * LAKH;
export const DEFAULT_TEAM_SIZE = 20;
export const MIN_BID = 3 * LAKH;
export const SLOT_VALUE = 10 * LAKH;
export const MIN_WOMEN = 2;
export const MIN_DEPARTMENTS = 6;
export const MAX_PER_DEPARTMENT = 6;

/**
 * How the auction pool (captains excluded) splits into squads.
 * Every team is first filled to `base` auctioned players. Only once every team has its
 * base squad do the `extra` leftover players go up as final lots, one per team.
 * e.g. 105 pool / 8 teams -> 13 auctioned + captain = 14 each, then 1 final lot makes one team 15.
 */
export type SeatPlan = { base: number; extra: number };

export function seatPlan(pool: number, teams: number): SeatPlan {
  if (pool <= 0 || teams <= 0) return { base: DEFAULT_TEAM_SIZE - 1, extra: 0 };
  const base = Math.floor(pool / teams);
  return { base, extra: pool - base * teams };
}

/** Seats one team has: `cap` is the most it may buy now, `required` is what it still must buy. */
export function teamSeats(plan: SeatPlan, squadCount: number, otherCounts: number[]) {
  const holdsExtra = squadCount > plan.base;
  const everyoneBase = squadCount >= plan.base && otherCounts.every((count) => count >= plan.base);
  const taken = otherCounts.filter((count) => count > plan.base).length;
  const extraOpen = plan.extra > 0 && (holdsExtra || (everyoneBase && taken < plan.extra));
  const cap = plan.base + (extraOpen ? 1 : 0);
  const left = Math.max(0, cap - squadCount);
  const required = Math.max(0, plan.base - squadCount);
  return { cap, left, required, runwaySeats: required > 0 ? required : left };
}

export function openingPurse(openingBalance: number | null | undefined) {
  return openingBalance == null ? CRORE : openingBalance;
}

export function bidStep(current: number) {
  if (current < 10 * LAKH) return 50_000;
  if (current < 25 * LAKH) return LAKH;
  return 2 * LAKH;
}

export function raiseStep(current: number | null) {
  if (current == null || current <= 0) return 50_000;
  return bidStep(current);
}

export function nextBidFloor(current: number | null) {
  if (current == null || current <= 0) return MIN_BID;
  return current + bidStep(current);
}

export function bidProblem(amount: number, current: number | null) {
  if (!Number.isInteger(amount) || amount < 0) return "Enter the bid as a whole number";
  if (amount < MIN_BID) return `The minimum bid is ${formatMoney(MIN_BID)}`;
  if (current == null || current <= 0) {
    if (amount % 50_000 !== 0) return `Open at ${formatMoney(MIN_BID)} or higher, in steps of ${formatMoney(50_000)}`;
    return null;
  }
  const step = bidStep(current);
  if (amount < current + step || (amount - current) % step !== 0) {
    return `Raise the bid by ${formatMoney(step)}, or a multiple of that, from ${formatMoney(current)}`;
  }
  return null;
}

export function squadGap(input: {
  spent: number;
  squadCount: number;
  seats: number;
  openingBalance?: number | null;
}) {
  const opening = openingPurse(input.openingBalance);
  const overspend = Math.max(0, input.spent - opening);
  const remaining = Math.max(0, input.seats - input.squadCount);
  const slotPenalty = input.spent >= opening ? remaining * SLOT_VALUE : 0;
  const lakhs = Math.round((overspend + slotPenalty) / LAKH);
  return lakhs === 0 ? 0 : -lakhs;
}

export type MemberFact = { department: string; gender: string };

export function memberFact(answers: unknown): MemberFact {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { department: "", gender: "" };
  }
  const bag = answers as Record<string, unknown>;
  return {
    department: pick(bag, /department/i),
    gender: pick(bag, /gender/i),
  };
}

export function isWoman(gender: string) {
  return /^(f|female|woman|w)$/i.test(gender.trim());
}

export type CircleState = "idle" | "ok" | "warn";

export type Composition = {
  women: number;
  departments: number;
  largest: number;
  genderKnown: boolean;
  womenOk: boolean | null;
  spreadOk: boolean;
  capOk: boolean;
  crossOk: boolean;
  womenLabel: string;
  crossLabel: string;
  /** Women still needed to reach MIN_WOMEN (0 when met or gender is unknown). */
  womenNeeded: number;
  /** Distinct departments still needed to reach MIN_DEPARTMENTS. */
  departmentsNeeded: number;
  /** People per department, largest first, in the spelling first seen. */
  departmentCounts: { name: string; count: number }[];
};

export function composition(members: MemberFact[]): Composition {
  const departments = members.map((member) => member.department.trim()).filter(Boolean);
  const unique = new Set(departments.map((department) => department.toLowerCase()));
  const counts = new Map<string, number>();
  const spelling = new Map<string, string>();
  for (const department of departments) {
    const key = department.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!spelling.has(key)) spelling.set(key, department);
  }
  const departmentCounts = [...counts.entries()]
    .map(([key, count]) => ({ name: spelling.get(key) ?? key, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const largest = Math.max(0, ...counts.values());
  const women = members.filter((member) => isWoman(member.gender)).length;
  const genderKnown = members.some((member) => member.gender.trim() !== "");
  const womenOk = genderKnown ? women >= MIN_WOMEN : null;
  const spreadOk = unique.size >= MIN_DEPARTMENTS;
  const capOk = largest <= MAX_PER_DEPARTMENT;
  return {
    women,
    departments: unique.size,
    largest,
    genderKnown,
    womenOk,
    spreadOk,
    capOk,
    crossOk: spreadOk && capOk,
    womenNeeded: genderKnown ? Math.max(0, MIN_WOMEN - women) : 0,
    departmentsNeeded: Math.max(0, MIN_DEPARTMENTS - unique.size),
    departmentCounts,
    womenLabel: genderKnown
      ? `At least ${MIN_WOMEN} women, including the captain (${women} marked)`
      : `At least ${MIN_WOMEN} women, including the captain (add a gender column)`,
    crossLabel: !capOk
      ? `No more than ${MAX_PER_DEPARTMENT} people from one department (${largest} so far)`
      : `People from at least ${MIN_DEPARTMENTS} departments (${unique.size} so far)`,
  };
}

export type SquadCheck = { label: string; ok: boolean | null };

export function squadChecks(members: MemberFact[]): SquadCheck[] {
  const mix = composition(members);
  return [
    { label: mix.womenLabel, ok: mix.womenOk },
    { label: `At least ${MIN_DEPARTMENTS} departments (${mix.departments} so far)`, ok: mix.spreadOk },
    { label: `No more than ${MAX_PER_DEPARTMENT} from one department (${mix.largest} so far)`, ok: mix.capOk },
  ];
}

export function overDepartmentCap(existingDepartments: string[], incoming: string) {
  const department = incoming.trim();
  if (!department) return null;
  const count = existingDepartments.filter(
    (item) => item.trim().toLowerCase() === department.toLowerCase(),
  ).length;
  if (count >= MAX_PER_DEPARTMENT) {
    return `${department} already has ${MAX_PER_DEPARTMENT} people on this team`;
  }
  return null;
}

/** A captain who cannot afford the opening bid is locked out of bidding. */
export function outOfMoney(balance: number | null | undefined) {
  return (balance ?? 0) < MIN_BID;
}

export function runwayMax(balance: number, seatsLeft: number) {
  if (seatsLeft <= 0) return 0;
  if (seatsLeft === 1) return Math.max(0, balance);
  return Math.max(0, balance - (seatsLeft - 1) * MIN_BID);
}

export type BidGate =
  | { kind: "ok" }
  | { kind: "stop"; reason: string }
  | { kind: "buzz"; message: string; womenFail: boolean; crossFail: boolean };

export function bidGate(input: {
  amount: number;
  balance: number;
  squadCount: number;
  /** Seats the team must fill (the base share). */
  seats: number;
  /** Most seats the team may fill, including an open extra seat. */
  cap: number;
  members: MemberFact[];
  incoming: MemberFact;
}): BidGate {
  if (input.cap - input.squadCount <= 0) return { kind: "stop", reason: "This squad is full" };
  if (outOfMoney(input.balance)) {
    return { kind: "stop", reason: "Purse is spent. Remaining seats are assigned after the auction" };
  }
  // No runway reserve: a captain may spend the whole purse on one player.
  const seatsAfter = Math.max(0, input.seats - input.squadCount - 1);

  const projected = composition([...input.members, input.incoming]);
  // Look ahead: after this player joins, the seats still open must be able to cover the women
  // and departments the squad still needs. On the last seat this is the plain completion check.
  const seatsWord = seatsAfter === 1 ? "1 seat" : `${seatsAfter} seats`;
  const womenFail = projected.womenNeeded > seatsAfter;
  const spreadFail = projected.departmentsNeeded > seatsAfter;
  const crossFail = !projected.capOk || spreadFail;
  if (!womenFail && !crossFail) return { kind: "ok" };

  const parts: string[] = [];
  if (womenFail) {
    parts.push(
      seatsAfter === 0
        ? projected.womenLabel
        : `Only ${seatsWord} would be left but ${projected.womenNeeded} more women are needed`,
    );
  }
  if (!projected.capOk) parts.push(projected.crossLabel);
  else if (spreadFail) {
    parts.push(
      seatsAfter === 0
        ? projected.crossLabel
        : `Only ${seatsWord} would be left but ${projected.departmentsNeeded} more departments are needed`,
    );
  }
  return {
    kind: "buzz",
    message: parts.join(". "),
    womenFail,
    crossFail,
  };
}

export function playerSkills(answers: Record<string, string> | null | undefined) {
  if (!answers) return [];
  const raw = pick(answers, /^(skills?|plays|expert)/i);
  return raw
    .split(/[,/;|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function playerBadge(answers: Record<string, string> | null | undefined) {
  if (!answers) return null;
  const value = pick(answers, /badge|categor|type|^role$/i);
  return value || null;
}

function pick(answers: Record<string, unknown>, pattern: RegExp) {
  const key = Object.keys(answers).find((item) => pattern.test(item));
  const value = key ? answers[key] : "";
  return typeof value === "string" ? value.trim() : "";
}
