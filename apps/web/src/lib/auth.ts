export const SESSION_COOKIE = "admin_session";

function adminSecret() {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) {
    throw new Error("ADMIN_PASSWORD is not set");
  }
  return value;
}

function bytesToBase64Url(bytes: ArrayBuffer) {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(adminSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(signature);
}

function fixedEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function createSessionToken() {
  const payload = `v1.${Date.now() + 1000 * 60 * 60 * 12}`;
  return `${payload}.${await sign(payload)}`;
}

export async function verifySessionToken(token: string | undefined | null) {
  if (!token || !process.env.ADMIN_PASSWORD) return false;
  const pieces = token.split(".");
  if (pieces.length !== 3) return false;
  const [version, exp, signature] = pieces;
  if (version !== "v1") return false;
  const payload = `${version}.${exp}`;
  const expected = await sign(payload);
  if (!fixedEqual(expected, signature)) return false;
  const expiresAt = Number(exp);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function passwordMatches(input: string) {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  const left = new TextEncoder().encode(input);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index]! ^ right[index]!;
  }
  return mismatch === 0;
}
