-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('owner', 'coordinator', 'member');

-- CreateEnum
CREATE TYPE "member_status" AS ENUM ('active', 'paused', 'left');

-- CreateEnum
CREATE TYPE "gameweek_status" AS ENUM ('open', 'locked', 'live', 'finished', 'settled');

-- CreateEnum
CREATE TYPE "obligation_reason" AS ENUM ('entry', 'free_pass', 'late_fee');

-- CreateEnum
CREATE TYPE "obligation_status" AS ENUM ('due', 'paid', 'waived');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('screenshot', 'sms', 'id', 'manual');

-- CreateEnum
CREATE TYPE "verify_status" AS ENUM ('pending', 'verified', 'needs_review', 'rejected');

-- CreateEnum
CREATE TYPE "source" AS ENUM ('fpl', 'manual');

-- CreateEnum
CREATE TYPE "fact_source" AS ENUM ('admin', 'ai', 'fpl');

-- CreateTable
CREATE TABLE "leagues" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "telegram_chat_id" BIGINT NOT NULL,
    "fpl_league_id" INTEGER NOT NULL,
    "first_pot_gw" INTEGER,
    "coordinator_telebirr_name" TEXT,
    "coordinator_telebirr_phone" TEXT,
    "rules" JSONB NOT NULL,
    "persona" JSONB NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
    "setup_state" TEXT NOT NULL DEFAULT 'pending',
    "join_token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "display_name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" SERIAL NOT NULL,
    "league_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "fpl_entry_id" INTEGER NOT NULL,
    "fpl_team_name" TEXT NOT NULL,
    "fpl_manager_name" TEXT NOT NULL,
    "role" "member_role" NOT NULL DEFAULT 'member',
    "status" "member_status" NOT NULL DEFAULT 'active',
    "roast_opt_out" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gameweeks" (
    "id" SERIAL NOT NULL,
    "league_id" INTEGER NOT NULL,
    "fpl_event_id" INTEGER NOT NULL,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "payment_opens_at" TIMESTAMPTZ(3) NOT NULL,
    "payment_closes_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "gameweek_status" NOT NULL DEFAULT 'open',
    "pot_amount" INTEGER NOT NULL DEFAULT 0,
    "carry_in" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "gameweeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligations" (
    "id" SERIAL NOT NULL,
    "gameweek_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "amount_due" INTEGER NOT NULL,
    "reason" "obligation_reason" NOT NULL,
    "status" "obligation_status" NOT NULL DEFAULT 'due',

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "obligation_id" INTEGER NOT NULL,
    "txn_id" TEXT,
    "amount" INTEGER NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "payer_name" TEXT,
    "receiver_match" BOOLEAN,
    "payer_match" BOOLEAN,
    "method" "payment_method" NOT NULL,
    "verify_status" "verify_status" NOT NULL DEFAULT 'pending',
    "verify_reason" TEXT,
    "reviewed_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" SERIAL NOT NULL,
    "gameweek_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "transfer_cost" INTEGER NOT NULL,
    "bench_points" INTEGER NOT NULL,
    "captain_points" INTEGER,
    "rank_in_gw" INTEGER,
    "source" "source" NOT NULL DEFAULT 'fpl',

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results" (
    "id" SERIAL NOT NULL,
    "gameweek_id" INTEGER NOT NULL,
    "winner_member_ids" INTEGER[],
    "runner_up_member_ids" INTEGER[],
    "payout_amount" INTEGER NOT NULL,
    "carry_out" INTEGER NOT NULL DEFAULT 0,
    "source" "source" NOT NULL DEFAULT 'fpl',
    "payout_txn_id" TEXT,
    "paid_out_at" TIMESTAMPTZ(3),

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_facts" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "fact" TEXT NOT NULL,
    "source" "fact_source" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages_log" (
    "id" SERIAL NOT NULL,
    "league_id" INTEGER NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "league_id" INTEGER NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leagues_telegram_chat_id_key" ON "leagues"("telegram_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "leagues_join_token_key" ON "leagues"("join_token");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE INDEX "members_user_id_idx" ON "members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_league_id_fpl_entry_id_key" ON "members"("league_id", "fpl_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_league_id_user_id_key" ON "members"("league_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gameweeks_league_id_fpl_event_id_key" ON "gameweeks"("league_id", "fpl_event_id");

-- CreateIndex
CREATE INDEX "obligations_member_id_idx" ON "obligations"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "obligations_gameweek_id_member_id_reason_key" ON "obligations"("gameweek_id", "member_id", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "payments_txn_id_key" ON "payments"("txn_id");

-- CreateIndex
CREATE INDEX "payments_obligation_id_idx" ON "payments"("obligation_id");

-- CreateIndex
CREATE INDEX "payments_verify_status_idx" ON "payments"("verify_status");

-- CreateIndex
CREATE INDEX "scores_member_id_idx" ON "scores"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "scores_gameweek_id_member_id_key" ON "scores"("gameweek_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "results_gameweek_id_key" ON "results"("gameweek_id");

-- CreateIndex
CREATE INDEX "member_facts_member_id_idx" ON "member_facts"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_log_league_id_dedupe_key_key" ON "messages_log"("league_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "audit_log_league_id_created_at_idx" ON "audit_log"("league_id", "created_at");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gameweeks" ADD CONSTRAINT "gameweeks_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "gameweeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "gameweeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "gameweeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_facts" ADD CONSTRAINT "member_facts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages_log" ADD CONSTRAINT "messages_log_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
