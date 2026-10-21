CREATE TYPE "public"."auction_status" AS ENUM('idle', 'open', 'sold', 'unsold');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('placed', 'won', 'lost', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."player_status" AS ENUM('available', 'on_block', 'sold', 'unsold');--> statement-breakpoint
CREATE TYPE "public"."tournament_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid,
	"actor" text DEFAULT 'admin' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auction_state" (
	"tournament_id" uuid PRIMARY KEY NOT NULL,
	"tournament_player_id" uuid,
	"status" "auction_status" DEFAULT 'idle' NOT NULL,
	"current_amount" integer,
	"current_team_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"tournament_player_id" uuid NOT NULL,
	"tournament_team_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" "bid_status" DEFAULT 'placed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brownie_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_standing_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captaincies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "game_standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"tournament_team_id" uuid NOT NULL,
	"score" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"name" text NOT NULL,
	"started_on" timestamp with time zone NOT NULL,
	"ended_on" timestamp with time zone,
	"max_score" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"photo_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_team_id" uuid NOT NULL,
	"tournament_player_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tournament_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"wants_to_be_captain" boolean DEFAULT false NOT NULL,
	"form_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auction_order" integer DEFAULT 0 NOT NULL,
	"status" "player_status" DEFAULT 'available' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"name" text NOT NULL,
	"logo_path" text,
	"opening_balance" integer,
	"penalty" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "tournament_status" DEFAULT 'draft' NOT NULL,
	"previous_tournament_id" uuid,
	"min_bid" integer,
	"max_bid" integer,
	"bid_jump" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_state" ADD CONSTRAINT "auction_state_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_state" ADD CONSTRAINT "auction_state_tournament_player_id_tournament_players_id_fk" FOREIGN KEY ("tournament_player_id") REFERENCES "public"."tournament_players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_state" ADD CONSTRAINT "auction_state_current_team_id_tournament_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_tournament_player_id_tournament_players_id_fk" FOREIGN KEY ("tournament_player_id") REFERENCES "public"."tournament_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_tournament_team_id_tournament_teams_id_fk" FOREIGN KEY ("tournament_team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brownie_points" ADD CONSTRAINT "brownie_points_game_standing_id_game_standings_id_fk" FOREIGN KEY ("game_standing_id") REFERENCES "public"."game_standings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captaincies" ADD CONSTRAINT "captaincies_tournament_team_id_tournament_teams_id_fk" FOREIGN KEY ("tournament_team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captaincies" ADD CONSTRAINT "captaincies_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_standings" ADD CONSTRAINT "game_standings_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_standings" ADD CONSTRAINT "game_standings_tournament_team_id_tournament_teams_id_fk" FOREIGN KEY ("tournament_team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_tournament_team_id_tournament_teams_id_fk" FOREIGN KEY ("tournament_team_id") REFERENCES "public"."tournament_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_tournament_player_id_tournament_players_id_fk" FOREIGN KEY ("tournament_player_id") REFERENCES "public"."tournament_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_teams" ADD CONSTRAINT "tournament_teams_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_previous_tournament_id_tournaments_id_fk" FOREIGN KEY ("previous_tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_tournament_time" ON "activity_log" USING btree ("tournament_id","created_at");--> statement-breakpoint
CREATE INDEX "bids_player_status" ON "bids" USING btree ("tournament_player_id","status");--> statement-breakpoint
CREATE INDEX "bids_team_status" ON "bids" USING btree ("tournament_team_id","status");--> statement-breakpoint
CREATE INDEX "bids_tournament_player" ON "bids" USING btree ("tournament_id","tournament_player_id");--> statement-breakpoint
CREATE INDEX "brownie_points_standing" ON "brownie_points" USING btree ("game_standing_id");--> statement-breakpoint
CREATE INDEX "captaincies_team_open" ON "captaincies" USING btree ("tournament_team_id","ended_at");--> statement-breakpoint
CREATE INDEX "captaincies_person_open" ON "captaincies" USING btree ("person_id","ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_standings_game_team" ON "game_standings" USING btree ("game_id","tournament_team_id");--> statement-breakpoint
CREATE INDEX "games_started" ON "games" USING btree ("tournament_id","started_on");--> statement-breakpoint
CREATE INDEX "squad_members_team_open" ON "squad_members" USING btree ("tournament_team_id","left_at");--> statement-breakpoint
CREATE INDEX "squad_members_player_open" ON "squad_members" USING btree ("tournament_player_id","left_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_players_tournament_person" ON "tournament_players" USING btree ("tournament_id","person_id");--> statement-breakpoint
CREATE INDEX "tournament_players_order" ON "tournament_players" USING btree ("tournament_id","auction_order");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_teams_tournament_name" ON "tournament_teams" USING btree ("tournament_id","name");--> statement-breakpoint
CREATE INDEX "tournament_teams_order" ON "tournament_teams" USING btree ("tournament_id","sort_order");