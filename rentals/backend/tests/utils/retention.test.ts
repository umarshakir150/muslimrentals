import { describe, it, expect } from 'vitest';
import { isSnapshotEligibleForRedaction, SNAPSHOT_RETENTION_DAYS } from '../../src/utils/retention';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function baseReport(overrides: Partial<Parameters<typeof isSnapshotEligibleForRedaction>[0]> = {}) {
  return {
    status: 'RESOLVED',
    resolvedAt: daysAgo(SNAPSHOT_RETENTION_DAYS + 1),
    retentionHold: false,
    snapshotRedactedAt: null,
    messageSnapshot: 'Pay me outside the app',
    ...overrides,
  };
}

describe('isSnapshotEligibleForRedaction', () => {
  it('is eligible once resolved for more than the retention window', () => {
    expect(isSnapshotEligibleForRedaction(baseReport())).toBe(true);
  });

  it('is eligible for a DISMISSED report too, not just RESOLVED', () => {
    expect(isSnapshotEligibleForRedaction(baseReport({ status: 'DISMISSED' }))).toBe(true);
  });

  it('is not eligible before the retention window has elapsed', () => {
    expect(isSnapshotEligibleForRedaction(baseReport({ resolvedAt: daysAgo(SNAPSHOT_RETENTION_DAYS - 1) }))).toBe(false);
  });

  it('is not eligible while the report is still PENDING (never resolved)', () => {
    expect(isSnapshotEligibleForRedaction(baseReport({ status: 'PENDING', resolvedAt: null }))).toBe(false);
  });

  it('is not eligible while retentionHold is set, no matter how old', () => {
    expect(isSnapshotEligibleForRedaction(baseReport({ retentionHold: true, resolvedAt: daysAgo(365) }))).toBe(false);
  });

  it('is not eligible if the snapshot has already been redacted', () => {
    expect(isSnapshotEligibleForRedaction(baseReport({ snapshotRedactedAt: daysAgo(1) }))).toBe(false);
  });

  it('is not eligible if there is no snapshot to redact', () => {
    expect(isSnapshotEligibleForRedaction(baseReport({ messageSnapshot: null }))).toBe(false);
  });

  it('is not eligible if resolvedAt is somehow null despite a terminal status (defensive)', () => {
    expect(isSnapshotEligibleForRedaction(baseReport({ resolvedAt: null }))).toBe(false);
  });
});
