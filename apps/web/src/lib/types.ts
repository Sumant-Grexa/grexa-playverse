export type SquadOutlook = {
  women: number;
  womenNeeded: number;
  /** Women needed beyond the seats left to fill them. */
  womenShort: number;
  departments: number;
  departmentsNeeded: number;
  /** Departments needed beyond the seats left to fill them. */
  departmentsShort: number;
  largest: number;
  capOk: boolean;
};

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
  /** Women still waiting to be auctioned (captains and the player on the block excluded). */
  womenWaiting: number;
  /** Departments still in the waiting pool, largest first. */
  departmentsWaiting: { name: string; count: number }[];
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
    department: string;
    badge: string | null;
    captainOf: string | null;
    lastSeason: { teamName: string; amount: number; refunded: boolean } | null;
    /** Opening-bid floor set when the player was sent back to auction. */
    minBid: number | null;
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
    needs: {
      women: number;
      departments: number;
      departmentCounts: { name: string; count: number }[];
      departmentCap: number;
    };
    /** Always-on runway check for the admin desk. */
    projection: {
      /** Seats the team still must fill to reach its base share. */
      seatsToFill: number;
      now: SquadOutlook;
      /** What the squad looks like if this team wins the player on the block. */
      ifWins: (SquadOutlook & { seatsAfter: number; ok: boolean }) | null;
    };
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
      captainGender: string;
      captainDepartment: string;
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
    /** Departments seen in form answers, for the captain department picker. */
    departments: string[];
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
  captainGender: string;
  captainDepartment: string;
  departments: string[];
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
