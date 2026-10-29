-- CreateTable
CREATE TABLE "LLMUsageLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "conversationId" TEXT,
    "ownerId" TEXT,
    "routingMode" TEXT NOT NULL DEFAULT 'single',
    "taskCategory" TEXT NOT NULL DEFAULT 'chat',
    "requestedModel" TEXT NOT NULL,
    "actualModel" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "routingReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LLMUsageLog_ownerId_idx" ON "LLMUsageLog"("ownerId");

-- CreateIndex
CREATE INDEX "LLMUsageLog_taskCategory_idx" ON "LLMUsageLog"("taskCategory");

-- CreateIndex
CREATE INDEX "LLMUsageLog_createdAt_idx" ON "LLMUsageLog"("createdAt");
