import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const tournamentStatus = pgEnum("tournament_status", [
  "draft",
  "active",
  "archived",
]);

export const playerStatus = pgEnum("player_status", [
  "available",
  "on_block",
  "sold",
  "unsold",
]);

export const auctionStatus = pgEnum("auction_status", [
  "idle",
  "open",
  "sold",
  "unsold",
]);

export const bidStatus = pgEnum("bid_status", [
  "placed",
  "won",
  "lost",
  "refunded",
]);

export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  photoPath: text("photo_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tournaments = pgTable("tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: tournamentStatus("status").notNull().default("draft"),
  previousTournamentId: uuid("previous_tournament_id").references(
    (): AnyPgColumn => tournaments.id,
    { onDelete: "set null" },
  ),
  minBid: integer("min_bid"),
  maxBid: integer("max_bid"),
  bidJump: integer("bid_jump"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tournamentPlayers = pgTable(
  "tournament_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    wantsToBeCaptain: boolean("wants_to_be_captain").notNull().default(false),
    formAnswers: jsonb("form_answers")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    auctionOrder: integer("auction_order").notNull().default(0),
    status: playerStatus("status").notNull().default("available"),
    /** Opening-bid floor for this player when sent back to auction; null uses the default. */
    minBid: integer("min_bid"),
  },
  (table) => [
    uniqueIndex("tournament_players_tournament_person").on(
      table.tournamentId,
      table.personId,
    ),
    index("tournament_players_order").on(table.tournamentId, table.auctionOrder),
  ],
);

export const tournamentTeams = pgTable(
  "tournament_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    logoPath: text("logo_path"),
    openingBalance: integer("opening_balance"),
    penalty: integer("penalty"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("tournament_teams_tournament_name").on(table.tournamentId, table.name),
    index("tournament_teams_order").on(table.tournamentId, table.sortOrder),
  ],
);

export const captaincies = pgTable(
  "captaincies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentTeamId: uuid("tournament_team_id")
      .notNull()
      .references(() => tournamentTeams.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("captaincies_team_open").on(table.tournamentTeamId, table.endedAt),
    index("captaincies_person_open").on(table.personId, table.endedAt),
  ],
);

export const squadMembers = pgTable(
  "squad_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentTeamId: uuid("tournament_team_id")
      .notNull()
      .references(() => tournamentTeams.id, { onDelete: "cascade" }),
    tournamentPlayerId: uuid("tournament_player_id")
      .notNull()
      .references(() => tournamentPlayers.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    index("squad_members_team_open").on(table.tournamentTeamId, table.leftAt),
    index("squad_members_player_open").on(table.tournamentPlayerId, table.leftAt),
  ],
);

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    tournamentPlayerId: uuid("tournament_player_id")
      .notNull()
      .references(() => tournamentPlayers.id, { onDelete: "cascade" }),
    tournamentTeamId: uuid("tournament_team_id")
      .notNull()
      .references(() => tournamentTeams.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    status: bidStatus("status").notNull().default("placed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bids_player_status").on(table.tournamentPlayerId, table.status),
    index("bids_team_status").on(table.tournamentTeamId, table.status),
    index("bids_tournament_player").on(table.tournamentId, table.tournamentPlayerId),
  ],
);

export const auctionState = pgTable("auction_state", {
  tournamentId: uuid("tournament_id")
    .primaryKey()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  tournamentPlayerId: uuid("tournament_player_id").references(() => tournamentPlayers.id, {
    onDelete: "set null",
  }),
  status: auctionStatus("status").notNull().default("idle"),
  currentAmount: integer("current_amount"),
  currentTeamId: uuid("current_team_id").references(() => tournamentTeams.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startedOn: timestamp("started_on", { withTimezone: true }).notNull(),
    endedOn: timestamp("ended_on", { withTimezone: true }),
    maxScore: integer("max_score").notNull(),
  },
  (table) => [index("games_started").on(table.tournamentId, table.startedOn)],
);

export const gameStandings = pgTable(
  "game_standings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    tournamentTeamId: uuid("tournament_team_id")
      .notNull()
      .references(() => tournamentTeams.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(0),
  },
  (table) => [uniqueIndex("game_standings_game_team").on(table.gameId, table.tournamentTeamId)],
);

export const browniePoints = pgTable(
  "brownie_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameStandingId: uuid("game_standing_id")
      .notNull()
      .references(() => gameStandings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: integer("value").notNull(),
  },
  (table) => [index("brownie_points_standing").on(table.gameStandingId)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").references(() => tournaments.id, {
      onDelete: "cascade",
    }),
    actor: text("actor").notNull().default("admin"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activity_log_tournament_time").on(table.tournamentId, table.createdAt)],
);

export const peopleRelations = relations(people, ({ many }) => ({
  tournamentPlayers: many(tournamentPlayers),
  captaincies: many(captaincies),
}));

export const tournamentsRelations = relations(tournaments, ({ many, one }) => ({
  players: many(tournamentPlayers),
  teams: many(tournamentTeams),
  games: many(games),
  bids: many(bids),
  activity: many(activityLog),
  auction: one(auctionState, {
    fields: [tournaments.id],
    references: [auctionState.tournamentId],
  }),
}));
