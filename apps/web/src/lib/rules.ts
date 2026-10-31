import { formatMoney } from "./format";

export const LAKH = 100_000;
export const CRORE = 100 * LAKH;
export const TEAM_SIZE = 20;
export const AUCTION_SEATS = TEAM_SIZE - 1;
export const MIN_BID = 3 * LAKH;
export const SLOT_VALUE = 10 * LAKH;
export const MIN_WOMEN = 2;
export const MIN_DEPARTMENTS = 6;
export const MAX_PER_DEPARTMENT = 6;

export function openingPurse(openingBalance: number | null | undefined) {
  return openingBalance == null ? CRORE : openingBalance;
}

export function bidStep(current: number) {
  if (current < 10 * LAKH) return 50_000;
  if (current <= 25 * LAKH) return LAKH;
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

export function squadGap(input: { spent: number; squadCount: number; openingBalance?: number | null }) {
  const opening = openingPurse(input.openingBalance);
  const overspend = Math.max(0, input.spent - opening);
  const remaining = Math.max(0, AUCTION_SEATS - input.squadCount);
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
};

export function composition(members: MemberFact[]): Composition {
  const departments = members.map((member) => member.department.trim()).filter(Boolean);
  const unique = new Set(departments.map((department) => department.toLowerCase()));
  const counts = new Map<string, number>();
  for (const department of departments) {
    const key = department.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
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
  members: MemberFact[];
  incoming: MemberFact;
}): BidGate {
  const seatsLeft = AUCTION_SEATS - input.squadCount;
  if (seatsLeft <= 0) return { kind: "stop", reason: "This squad is full" };
  const seatsAfter = seatsLeft - 1;
  const purseAfter = input.balance - input.amount;
  const overPurse = input.amount > input.balance;
  if (!overPurse && seatsAfter > 0 && purseAfter < seatsAfter * MIN_BID) {
    return { kind: "stop", reason: "Keep runway for the remaining seats" };
  }

  const projected = composition([...input.members, input.incoming]);
  const completing = seatsAfter === 0 || purseAfter === 0;
  const womenFail = completing && projected.womenOk === false;
  const crossFail = !projected.capOk || (completing && !projected.spreadOk);
  if (!womenFail && !crossFail) return { kind: "ok" };

  const parts: string[] = [];
  if (womenFail) parts.push(projected.womenLabel);
  if (crossFail) parts.push(projected.crossLabel);
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
