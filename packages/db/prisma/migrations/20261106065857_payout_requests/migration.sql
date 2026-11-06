-- CreateTable
CREATE TABLE "payout_requests" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "gameweek_id" INTEGER NOT NULL,
    "member_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_requests_user_id_chat_id_key" ON "payout_requests"("user_id", "chat_id");
