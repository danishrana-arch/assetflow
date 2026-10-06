-- Email invitations for new employees (Employee Forms → Invite new employee).
CREATE TABLE "UserInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "message" TEXT,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserInvitation_userId_key" ON "UserInvitation"("userId");
CREATE UNIQUE INDEX "UserInvitation_tokenHash_key" ON "UserInvitation"("tokenHash");
CREATE INDEX "UserInvitation_organizationId_createdAt_idx" ON "UserInvitation"("organizationId", "createdAt");

ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
