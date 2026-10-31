export function defaultTeamName(captainName: string) {
  const name = captainName.trim();
  return name ? `${name}'s team` : "New team";
}

const BADGE_KINDS = [
  ["collaborator", "Collaborator"],
  ["entertainer", "Entertainer"],
  ["executer", "Executer"],
  ["risktaker", "Risk taker"],
  ["strategist", "Strategist"],
] as const;

export function badgeLook(raw: string | null | undefined) {
  if (!raw?.trim()) return null;
  const compact = raw
    .trim()
    .replace(/^the\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const match = BADGE_KINDS.find(([kind, label]) => {
    const fromLabel = label.toLowerCase().replace(/[^a-z]/g, "");
    if (compact === kind || compact === fromLabel) return true;
    if (kind === "executer" && (compact === "executor" || compact === "execute")) return true;
    if (kind === "risktaker" && compact.includes("risk")) return true;
    return compact.includes(fromLabel);
  });
  if (!match) {
    return { kind: "other" as const, label: raw.trim().replace(/^the\s+/i, "") };
  }
  return { kind: match[0], label: match[1] };
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatLakhs(amount: number) {
  const value = amount / 100_000;
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${shown}L`;
}

export function formatCompactBid(amount: number) {
  if (amount >= 10_000_000) {
    return `${compactNumber(amount / 10_000_000)} Cr`;
  }
  const lacs = amount / 100_000;
  return `${compactNumber(lacs)} ${lacs === 1 ? "Lac" : "Lacs"}`;
}

function compactNumber(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function labelize(key: string) {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function monogram(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function parseWholeNumber(value: string) {
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) return null;
  return Number(text);
}
