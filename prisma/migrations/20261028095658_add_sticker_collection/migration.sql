-- CreateTable
CREATE TABLE "StickerItem" (
    "id" TEXT NOT NULL,
    "stickerId" TEXT NOT NULL,
    "emotion" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'collector',
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickerItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StickerSession" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emotion" TEXT NOT NULL,
    "addedIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StickerSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StickerItem_emotion_idx" ON "StickerItem"("emotion");

-- CreateIndex
CREATE UNIQUE INDEX "StickerItem_stickerId_emotion_key" ON "StickerItem"("stickerId", "emotion");

-- CreateIndex
CREATE UNIQUE INDEX "StickerSession_chatId_key" ON "StickerSession"("chatId");

-- CreateIndex
CREATE INDEX "StickerSession_chatId_idx" ON "StickerSession"("chatId");
