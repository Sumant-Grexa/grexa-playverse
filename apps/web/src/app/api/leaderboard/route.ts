import { getLeaderboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = await getLeaderboard();
  return Response.json(board, { headers: { "Cache-Control": "no-store" } });
}
