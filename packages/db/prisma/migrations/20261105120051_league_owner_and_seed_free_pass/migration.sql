/*
  Warnings:

  - Added the required column `owner_user_id` to the `leagues` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "leagues" ADD COLUMN     "owner_user_id" INTEGER NOT NULL,
ADD COLUMN     "seed_free_pass_member_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AddForeignKey
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
