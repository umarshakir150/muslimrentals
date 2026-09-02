-- CreateTable
CREATE TABLE "UserMessageRestriction" (
    "id" TEXT NOT NULL,
    "restrictedUserId" TEXT NOT NULL,
    "protectedUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "UserMessageRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserMessageRestriction_restrictedUserId_protectedUserId_key" ON "UserMessageRestriction"("restrictedUserId", "protectedUserId");

-- CreateIndex
CREATE INDEX "UserMessageRestriction_protectedUserId_idx" ON "UserMessageRestriction"("protectedUserId");

-- AddForeignKey
ALTER TABLE "UserMessageRestriction" ADD CONSTRAINT "UserMessageRestriction_restrictedUserId_fkey" FOREIGN KEY ("restrictedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMessageRestriction" ADD CONSTRAINT "UserMessageRestriction_protectedUserId_fkey" FOREIGN KEY ("protectedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
