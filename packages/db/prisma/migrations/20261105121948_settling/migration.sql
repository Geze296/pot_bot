-- AlterTable
ALTER TABLE "gameweeks" ADD COLUMN     "final_seen_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "leagues" ADD COLUMN     "coordinator_user_id" INTEGER;

-- AlterTable
ALTER TABLE "results" ADD COLUMN     "free_pass_member_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "half_price_member_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "payout_shares" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "scores" ADD COLUMN     "total_points" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_coordinator_user_id_fkey" FOREIGN KEY ("coordinator_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
