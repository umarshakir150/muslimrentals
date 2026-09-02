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

-- RLS: match the least-privilege baseline every other table already has
-- (see 20260828011000_enable_rls_least_privilege) -- this app's only
-- intended access path is the Express/Prisma backend (postgres role,
-- BYPASSRLS=true), so anon/authenticated (PostgREST) get no access to
-- this new table either, same as everything else.
ALTER TABLE "UserMessageRestriction" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "UserMessageRestriction" FROM PUBLIC, anon, authenticated;
