import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const IMAGE_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function uploadRoot() {
  const raw = process.env.UPLOAD_DIR ?? "data/uploads";
  if (path.isAbsolute(raw)) return raw;
  const cwd = process.cwd();
  const root = cwd.endsWith(`${path.sep}apps${path.sep}web`)
    ? path.resolve(cwd, "../..")
    : cwd;
  return path.resolve(root, raw);
}

export function safeName(filename: string) {
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "-");
  return base || "file";
}

export function resolveInside(relativePath: string) {
  const cleaned = relativePath
    .split(/[\\/]+/)
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  const full = path.resolve(uploadRoot(), cleaned);
  const root = uploadRoot();
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error("That file path is not allowed");
  }
  return full;
}

export function mediaUrl(relativePath: string | null | undefined) {
  if (!relativePath) return null;
  return `/api/media/${relativePath
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function contentTypeFor(relativePath: string) {
  return IMAGE_TYPES[path.extname(relativePath).toLowerCase()] ?? null;
}

export async function saveUpload(relativePath: string, bytes: Buffer) {
  if (!contentTypeFor(relativePath)) {
    throw new Error("Upload a png, jpg, webp, gif, or svg");
  }
  const full = resolveInside(relativePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return relativePath
    .split(/[\\/]+/)
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}
