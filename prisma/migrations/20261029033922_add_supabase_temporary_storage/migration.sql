-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('UPLOADING', 'ACTIVE', 'DELETING', 'DELETED', 'DELETE_FAILED');

-- AlterEnum
ALTER TYPE "StorageProviderType" ADD VALUE 'SUPABASE';

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "deleteAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "lastDeleteAttemptAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "status" "FileStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "uploadedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "StoredFile_conversationId_idx" ON "StoredFile"("conversationId");

-- CreateIndex
CREATE INDEX "StoredFile_status_expiresAt_idx" ON "StoredFile"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "StoredFile_expiresAt_idx" ON "StoredFile"("expiresAt");
