import { LiveBoard } from "@/components/live-board";
import { getLive } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const live = await getLive();
  return <LiveBoard initial={live} />;
}
