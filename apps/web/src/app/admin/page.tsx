import { AuctionConsole } from "@/components/auction-console";
import { SiteHeader } from "@/components/site-header";
import { getLive } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AdminAuctionPage() {
  const live = await getLive();
  return (
    <>
      <SiteHeader tournamentName={live.tournament?.name ?? null} mode="admin" />
      <AuctionConsole initial={live} />
    </>
  );
}
