import { prisma } from '../prisma/client';

// Narrower than the account-wide `isBanned` flag: true only when
// `restrictedUserId` has been specifically stopped from messaging
// `protectedUserId` (e.g. the user a report was filed against, restricted
// from messaging the reporter who filed it) and that restriction has not
// since been lifted.
export async function isRestrictedFromMessaging(restrictedUserId: string, protectedUserId: string): Promise<boolean> {
  if (restrictedUserId === protectedUserId) return false;
  const restriction = await prisma.userMessageRestriction.findUnique({
    where: { restrictedUserId_protectedUserId: { restrictedUserId, protectedUserId } },
  });
  return !!restriction && !restriction.liftedAt;
}
