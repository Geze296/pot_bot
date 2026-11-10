-- AlterTable
ALTER TABLE "gameweeks" ADD COLUMN     "poll_closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "poll_id" TEXT,
ADD COLUMN     "poll_message_id" INTEGER,
ADD COLUMN     "poll_options" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "predictions" (
    "id" SERIAL NOT NULL,
    "gameweek_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "picked_member_id" INTEGER NOT NULL,
    "voted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "predictions_gameweek_id_member_id_key" ON "predictions"("gameweek_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "gameweeks_poll_id_key" ON "gameweeks"("poll_id");

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_gameweek_id_fkey" FOREIGN KEY ("gameweek_id") REFERENCES "gameweeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_picked_member_id_fkey" FOREIGN KEY ("picked_member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

