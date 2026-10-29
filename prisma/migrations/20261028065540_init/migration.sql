-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ALLOWED_USER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('PRIVATE', 'GROUP');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VOICE', 'STICKER', 'FILE', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'PLANNING', 'RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'RETRYING', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StorageProviderType" AS ENUM ('LOCAL', 'R2');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "zaloUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingToken" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "usedByZaloId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "PairingToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'ZALO_OFFICIAL_BOT',
    "externalChatId" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL DEFAULT 'PRIVATE',
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "attachmentsJson" JSONB,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEvent" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'ZALO_OFFICIAL_BOT',
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadRedactedJson" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "conversationId" TEXT,
    "request" TEXT NOT NULL,
    "title" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "resultSummary" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskStep" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "sanitizedInputJson" JSONB,
    "sanitizedOutputJson" JSONB,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,

    CONSTRAINT "TaskStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "redactedInputJson" JSONB,
    "redactedOutputJson" JSONB,
    "timingsMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "exactActionHash" TEXT NOT NULL,
    "encryptedOrRedactedPayload" JSONB NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "taskId" TEXT,
    "provider" "StorageProviderType" NOT NULL DEFAULT 'LOCAL',
    "bucket" TEXT,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "text" TEXT NOT NULL,
    "source" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "scopes" TEXT NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessageIndex" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "subject" TEXT,
    "sender" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "classification" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessageIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "scheduleType" TEXT NOT NULL,
    "cronExpression" TEXT,
    "runAt" TIMESTAMP(3),
    "payloadJson" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "description" TEXT NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "workflowJson" JSONB NOT NULL,
    "permissionsJson" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "taskId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "sanitizedDetailsJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_zaloUserId_key" ON "User"("zaloUserId");

-- CreateIndex
CREATE INDEX "User_zaloUserId_idx" ON "User"("zaloUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PairingToken_codeHash_key" ON "PairingToken"("codeHash");

-- CreateIndex
CREATE INDEX "Conversation_externalChatId_idx" ON "Conversation"("externalChatId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_channel_externalChatId_key" ON "Conversation"("channel", "externalChatId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_externalMessageId_idx" ON "Message"("externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEvent_externalEventId_key" ON "InboundEvent"("externalEventId");

-- CreateIndex
CREATE INDEX "InboundEvent_channel_externalEventId_idx" ON "InboundEvent"("channel", "externalEventId");

-- CreateIndex
CREATE INDEX "InboundEvent_status_idx" ON "InboundEvent"("status");

-- CreateIndex
CREATE INDEX "AgentTask_ownerId_idx" ON "AgentTask"("ownerId");

-- CreateIndex
CREATE INDEX "AgentTask_status_idx" ON "AgentTask"("status");

-- CreateIndex
CREATE INDEX "AgentTask_createdAt_idx" ON "AgentTask"("createdAt");

-- CreateIndex
CREATE INDEX "TaskStep_taskId_sequence_idx" ON "TaskStep"("taskId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ToolExecution_toolCallId_key" ON "ToolExecution"("toolCallId");

-- CreateIndex
CREATE INDEX "ToolExecution_taskId_idx" ON "ToolExecution"("taskId");

-- CreateIndex
CREATE INDEX "ToolExecution_toolCallId_idx" ON "ToolExecution"("toolCallId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_codeHash_key" ON "Approval"("codeHash");

-- CreateIndex
CREATE INDEX "Approval_taskId_idx" ON "Approval"("taskId");

-- CreateIndex
CREATE INDEX "Approval_ownerId_idx" ON "Approval"("ownerId");

-- CreateIndex
CREATE INDEX "Approval_status_idx" ON "Approval"("status");

-- CreateIndex
CREATE INDEX "Approval_codeHash_idx" ON "Approval"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_objectKey_key" ON "StoredFile"("objectKey");

-- CreateIndex
CREATE INDEX "StoredFile_ownerId_idx" ON "StoredFile"("ownerId");

-- CreateIndex
CREATE INDEX "StoredFile_taskId_idx" ON "StoredFile"("taskId");

-- CreateIndex
CREATE INDEX "StoredFile_objectKey_idx" ON "StoredFile"("objectKey");

-- CreateIndex
CREATE INDEX "Memory_ownerId_category_idx" ON "Memory"("ownerId", "category");

-- CreateIndex
CREATE INDEX "EmailAccount_ownerId_idx" ON "EmailAccount"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_ownerId_email_key" ON "EmailAccount"("ownerId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessageIndex_gmailMessageId_key" ON "EmailMessageIndex"("gmailMessageId");

-- CreateIndex
CREATE INDEX "EmailMessageIndex_accountId_threadId_idx" ON "EmailMessageIndex"("accountId", "threadId");

-- CreateIndex
CREATE INDEX "EmailMessageIndex_accountId_receivedAt_idx" ON "EmailMessageIndex"("accountId", "receivedAt");

-- CreateIndex
CREATE INDEX "ScheduledTask_ownerId_idx" ON "ScheduledTask"("ownerId");

-- CreateIndex
CREATE INDEX "ScheduledTask_enabled_nextRunAt_idx" ON "ScheduledTask"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "Skill_name_idx" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_taskId_idx" ON "AuditLog"("taskId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_idx" ON "AuditLog"("occurredAt");

-- AddForeignKey
ALTER TABLE "PairingToken" ADD CONSTRAINT "PairingToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskStep" ADD CONSTRAINT "TaskStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessageIndex" ADD CONSTRAINT "EmailMessageIndex_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
