import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture whatever config multerS3() is called with, without needing real
// AWS/R2 credentials or network access -- module import alone (uploads.ts
// calls makeS3Storage() at the top level to build listingUpload/avatarUpload)
// is enough to trigger the call we want to inspect.
const multerS3Mock = vi.hoisted(() => vi.fn((config: unknown) => ({ __storageConfig: config })));
vi.mock('multer-s3', () => ({
  default: Object.assign(multerS3Mock, { AUTO_CONTENT_TYPE: 'auto-content-type' }),
}));

const ORIGINAL_ENV = { ...process.env };

describe('uploads.ts S3 storage config', () => {
  beforeEach(() => {
    vi.resetModules();
    multerS3Mock.mockClear();
    process.env = { ...ORIGINAL_ENV };
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.AWS_S3_BUCKET = 'test-bucket';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('sets acl: public-read for real AWS S3 (no custom endpoint)', async () => {
    delete process.env.S3_ENDPOINT;
    await import('../../src/routes/uploads');

    expect(multerS3Mock).toHaveBeenCalled();
    const config = multerS3Mock.mock.calls[0][0] as Record<string, unknown>;
    expect(config.acl).toBe('public-read');
  });

  it('omits acl entirely for a custom S3-compatible endpoint (e.g. Cloudflare R2)', async () => {
    // R2's S3-compatible API does not support per-object ACLs; sending
    // acl: 'public-read' makes every PutObject call fail. This is the fix
    // for the confirmed production bug: "Listing posted, but photo upload
    // failed" / "An unexpected error occurred" on every upload attempt.
    process.env.S3_ENDPOINT = 'https://example-account-id.r2.cloudflarestorage.com';
    await import('../../src/routes/uploads');

    expect(multerS3Mock).toHaveBeenCalled();
    const config = multerS3Mock.mock.calls[0][0] as Record<string, unknown>;
    expect(config).not.toHaveProperty('acl');
  });

  it('still sets bucket and content type correctly for a custom endpoint', async () => {
    process.env.S3_ENDPOINT = 'https://example-account-id.r2.cloudflarestorage.com';
    await import('../../src/routes/uploads');

    const config = multerS3Mock.mock.calls[0][0] as Record<string, unknown>;
    expect(config.bucket).toBe('test-bucket');
    expect(config.contentType).toBe('auto-content-type');
  });
});
