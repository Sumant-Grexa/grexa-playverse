import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { TeamEditor } from "@/components/team-editor";
import { getActiveTournament, getTeamDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AdminTeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const team = await getTeamDetail(teamId);
  if (!team) notFound();
  const active = await getActiveTournament();
  return (
    <>
      <SiteHeader tournamentName={active?.name ?? team.tournamentName} mode="admin" />
      <TeamEditor team={team} />
    </>
  );
}
