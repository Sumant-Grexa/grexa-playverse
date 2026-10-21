import { getLive } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const live = await getLive();
  return Response.json(live, { headers: { "Cache-Control": "no-store" } });
}
