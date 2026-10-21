import { readFile } from "node:fs/promises";
import { contentTypeFor, resolveInside } from "@/lib/uploads";

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const relative = path.join("/");
  const type = contentTypeFor(relative);
  if (!type) return new Response("Unsupported file", { status: 415 });
  try {
    const bytes = await readFile(resolveInside(relative));
    return new Response(bytes, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
