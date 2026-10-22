import { formatMoney } from "./format";

export const LAKH = 100_000;
export const CRORE = 100 * LAKH;
export const TEAM_SIZE = 20;
export const AUCTION_SEATS = TEAM_SIZE - 1;
export const MIN_BID = 3 * LAKH;
export const SLOT_VALUE = 10 * LAKH;

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

export type SquadCheck = { label: string; ok: boolean | null };

export function squadChecks(members: MemberFact[]): SquadCheck[] {
  const departments = members.map((member) => member.department.trim()).filter(Boolean);
  const unique = new Set(departments.map((department) => department.toLowerCase()));
  const counts = new Map<string, number>();
  for (const department of departments) {
    const key = department.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const largest = Math.max(0, ...counts.values());
  const women = members.filter((member) => /^(f|female|woman|w)$/i.test(member.gender.trim())).length;
  const genderKnown = members.some((member) => member.gender.trim() !== "");
  return [
    {
      label: genderKnown ? `At least 4 women (${women} marked)` : "At least 4 women (add a gender column)",
      ok: genderKnown ? women >= 4 : null,
    },
    { label: `At least 6 departments (${unique.size} so far)`, ok: unique.size >= MIN_DEPARTMENTS },
    { label: `No more than 8 from one department (${largest} so far)`, ok: largest <= 8 },
    { label: "At least one person from Client Support", ok: departments.some((department) => /client support/i.test(department)) },
    {
      label: "At least one person from Tech, Product, or Growth",
      ok: departments.some((department) => /^(tech|product|growth)\b/i.test(department)),
    },
    { label: "A balanced mix of business, customer-facing, and operational roles", ok: null },
  ];
}

const MIN_DEPARTMENTS = 6;

export function overDepartmentCap(existingDepartments: string[], incoming: string) {
  const department = incoming.trim();
  if (!department) return null;
  const count = existingDepartments.filter(
    (item) => item.trim().toLowerCase() === department.toLowerCase(),
  ).length;
  if (count >= 8) return `${department} already has 8 people on this team`;
  return null;
}

function pick(answers: Record<string, unknown>, pattern: RegExp) {
  const key = Object.keys(answers).find((item) => pattern.test(item));
  const value = key ? answers[key] : "";
  return typeof value === "string" ? value.trim() : "";
}
