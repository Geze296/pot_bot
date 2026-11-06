/*
  Warnings:

  - You are about to drop the column `payout_txn_id` on the `results` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "results" DROP COLUMN "payout_txn_id";

-- CreateTable
CREATE TABLE "payouts" (
    "id" SERIAL NOT NULL,
    "result_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "txn_id" TEXT,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by" INTEGER NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_txn_id_key" ON "payouts"("txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_result_id_member_id_key" ON "payouts"("result_id", "member_id");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
