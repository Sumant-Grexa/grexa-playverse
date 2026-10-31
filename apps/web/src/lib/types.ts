export type LivePayload = {
  tournament: {
    id: string;
    name: string;
    minBid: number | null;
    maxBid: number | null;
    bidJump: number | null;
  } | null;
  state: {
    status: "idle" | "open" | "sold" | "unsold";
    currentAmount: number | null;
    currentTeamId: string | null;
    currentCaptainName: string | null;
    overPurse: boolean;
  };
  waiting: number;
  notice: {
    id: string;
    teamId: string;
    captainName: string;
    amount: number;
    message: string;
    womenFail: boolean;
    crossFail: boolean;
    overPurse: boolean;
  } | null;
  marks: {
    lastBid: { teamName: string; playerName: string; amount: number } | null;
    topBid: { teamName: string; playerName: string; amount: number } | null;
    saleId: string | null;
  };
  player: {
    id: string;
    name: string;
    photoUrl: string | null;
    formAnswers: Record<string, string>;
    skills: string[];
    badge: string | null;
    captainOf: string | null;
    lastSeason: { teamName: string; amount: number; refunded: boolean } | null;
  } | null;
  tape: {
    id: string;
    teamId: string;
    captainName: string;
    captainPhotoUrl: string | null;
    amount: number;
    overPurse: boolean;
  }[];
  teams: {
    id: string;
    name: string;
    logoUrl: string | null;
    balance: number | null;
    captainName: string | null;
    captainPhotoUrl: string | null;
    squadCount: number;
    seatsLeft: number;
    runway: number;
    women: { state: "idle" | "ok" | "warn"; label: string };
    cross: { state: "idle" | "ok" | "warn"; label: string };
  }[];
  ceremony: null | {
    teams: {
      id: string;
      name: string;
      logoUrl: string | null;
      captainName: string | null;
      captainPhotoUrl: string | null;
      players: string[];
    }[];
  };
};

export type LeaderboardPayload = {
  tournament: { id: string; name: string } | null;
  scale: number;
  totals: {
    teamId: string;
    teamName: string;
    logoUrl: string | null;
    total: number;
    squadGap: number;
  }[];
  games: {
    id: string;
    name: string;
    startedOn: string;
    endedOn: string | null;
    maxScore: number;
    rows: {
      standingId: string;
      teamId: string;
      teamName: string;
      logoUrl: string | null;
      score: number;
      brownies: { id: string; name: string; value: number }[];
      total: number;
    }[];
  }[];
};

export type TournamentSummary = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
};

export type TournamentDesk = {
  tournaments: TournamentSummary[];
  selected: null | {
    id: string;
    name: string;
    status: "draft" | "active" | "archived";
    previousTournamentId: string | null;
    minBid: number | null;
    maxBid: number | null;
    bidJump: number | null;
    teams: {
      id: string;
      name: string;
      logoUrl: string | null;
      openingBalance: number | null;
      balance: number | null;
      penalty: number | null;
      captainPersonId: string | null;
      captainName: string | null;
      captainPhotoUrl: string | null;
      squad: { tournamentPlayerId: string; name: string; refundAmount: number }[];
      checks: { label: string; ok: boolean | null }[];
      squadGap: number;
    }[];
    players: {
      tournamentPlayerId: string;
      personId: string;
      name: string;
      photoUrl: string | null;
      status: "available" | "on_block" | "sold" | "unsold";
      wantsToBeCaptain: boolean;
      isCaptain: boolean;
    }[];
    activity: {
      id: string;
      action: string;
      createdAt: string;
      payload: Record<string, unknown>;
    }[];
  };
};

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; buzz?: boolean };

export type PublicTeamList = {
  tournamentName: string | null;
  teams: {
    id: string;
    name: string;
    logoUrl: string | null;
    captainName: string | null;
    captainPhotoUrl: string | null;
    squadCount: number;
    remaining: number;
  }[];
};

export type TeamDetail = {
  id: string;
  name: string;
  logoUrl: string | null;
  tournamentId: string;
  tournamentName: string;
  captainName: string | null;
  captainPhotoUrl: string | null;
  captainPersonId: string | null;
  remaining: number;
  openingBalance: number;
  squadCount: number;
  checks: { label: string; ok: boolean | null }[];
  members: {
    tournamentPlayerId: string;
    name: string;
    photoUrl: string | null;
    amount: number;
  }[];
  available: { tournamentPlayerId: string; name: string }[];
  people: { personId: string; name: string }[];
};
