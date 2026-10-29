-- CreateTable
CREATE TABLE "GeneratedImage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "taskId" TEXT,
    "fileId" TEXT NOT NULL,
    "parentImageId" TEXT,
    "prompt" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL DEFAULT 'generate',
    "aspectRatio" TEXT,
    "resolution" TEXT,
    "costUsd" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedImage_fileId_key" ON "GeneratedImage"("fileId");

-- CreateIndex
CREATE INDEX "GeneratedImage_ownerId_conversationId_idx" ON "GeneratedImage"("ownerId", "conversationId");

-- CreateIndex
CREATE INDEX "GeneratedImage_createdAt_idx" ON "GeneratedImage"("createdAt");

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_parentImageId_fkey" FOREIGN KEY ("parentImageId") REFERENCES "GeneratedImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
