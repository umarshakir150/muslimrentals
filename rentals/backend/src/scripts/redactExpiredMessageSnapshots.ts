// One-shot, run-on-demand job implementing the messageSnapshot retention
// policy (founder-approved, 2026-09-02): clears a MESSAGE report's frozen
// snapshot once it has been RESOLVED/DISMISSED for SNAPSHOT_RETENTION_DAYS,
// unless retentionHold is set. The report row itself (status, reason,
// resolution) is never touched -- only messageSnapshot is cleared, and
// snapshotRedactedAt is stamped so this never reprocesses the same row.
//
// Deliberately NOT wired to a scheduler yet -- the founder explicitly
// approved staging automation for later while report volume is low. Run
// manually for now: `npm run retention:redact-snapshots`.
import { prisma } from '../prisma/client';
import { logger } from '../utils/logger';
import { isSnapshotEligibleForRedaction } from '../utils/retention';

async function main() {
  const candidates = await prisma.report.findMany({
    where: {
      targetType: 'MESSAGE',
      messageSnapshot: { not: null },
      snapshotRedactedAt: null,
      retentionHold: false,
      status: { in: ['RESOLVED', 'DISMISSED'] },
    },
    select: { id: true, status: true, resolvedAt: true, retentionHold: true, snapshotRedactedAt: true, messageSnapshot: true },
  });

  const now = new Date();
  const eligible = candidates.filter(r => isSnapshotEligibleForRedaction(r, now));

  for (const report of eligible) {
    await prisma.report.update({
      where: { id: report.id },
      data: { messageSnapshot: null, snapshotRedactedAt: now },
    });
  }

  logger.info(`Retention: redacted ${eligible.length} of ${candidates.length} candidate MESSAGE report snapshot(s).`);
}

main()
  .catch(err => {
    logger.error('Retention: redaction job failed.', err);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
