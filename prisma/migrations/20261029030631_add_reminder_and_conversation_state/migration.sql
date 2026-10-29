-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'ZALO_OFFICIAL_BOT',
    "recipientChatId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "queuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "createdFromMessageId" TEXT,
    "sourceConversationId" TEXT,
    "isLateNoticeSent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationState" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "chatType" TEXT NOT NULL DEFAULT 'PRIVATE',
    "currentTopic" TEXT,
    "activeTaskId" TEXT,
    "lastReminderId" TEXT,
    "lastEmailThreadIds" JSONB,
    "lastFileIds" JSONB,
    "lastImageIds" JSONB,
    "pendingClarification" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_ownerId_idx" ON "Reminder"("ownerId");

-- CreateIndex
CREATE INDEX "Reminder_status_dueAt_idx" ON "Reminder"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Reminder_recipientChatId_idx" ON "Reminder"("recipientChatId");

-- CreateIndex
CREATE INDEX "Reminder_createdFromMessageId_idx" ON "Reminder"("createdFromMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationState_conversationId_key" ON "ConversationState"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationState_chatId_userId_idx" ON "ConversationState"("chatId", "userId");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
