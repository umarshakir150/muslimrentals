import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture whatever config multerS3() is called with, without needing real
// AWS/R2 credentials or network access -- module import alone (uploads.ts
// calls makeS3Storage() at the top level to build listingUpload/avatarUpload)
// is enough to trigger the call we want to inspect.
const multerS3Mock = vi.hoisted(() => vi.fn((config: unknown) => ({ __storageConfig: config })));
vi.mock('multer-s3', () => ({
  default: Object.assign(multerS3Mock, { AUTO_CONTENT_TYPE: 'auto-content-type' }),
}));

// uploads.ts now runs a fire-and-forget HeadBucket startup self-check the
// moment the module loads (see uploads.ts) -- mock the S3 client so tests
// control exactly whether that check succeeds or fails, deterministically
// and without any real network call.
const s3SendMock = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = s3SendMock; },
  DeleteObjectCommand: class { constructor(public input: any) {} },
  HeadBucketCommand: class { constructor(public input: any) {} },
}));

const loggerInfoMock  = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());
const loggerWarnMock  = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/logger', () => ({
  logger: { info: loggerInfoMock, error: loggerErrorMock, warn: loggerWarnMock, debug: vi.fn() },
}));

const ORIGINAL_ENV = { ...process.env };

describe('uploads.ts S3 storage config', () => {
  beforeEach(() => {
    vi.resetModules();
    multerS3Mock.mockClear();
    s3SendMock.mockReset();
    loggerInfoMock.mockClear();
    loggerErrorMock.mockClear();
    loggerWarnMock.mockClear();
    process.env = { ...ORIGINAL_ENV };
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.AWS_S3_BUCKET = 'test-bucket';
    // Default: startup self-check succeeds, so the acl/config-shape tests
    // below aren't coupled to self-check behavior.
    s3SendMock.mockResolvedValue({});
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

  it('runs a HeadBucket startup self-check and logs success when credentials/bucket are valid', async () => {
    s3SendMock.mockResolvedValue({});
    await import('../../src/routes/uploads');
    // The check is fire-and-forget (a .then/.catch on the send() promise);
    // flush microtasks so it resolves before asserting.
    await new Promise(process.nextTick);

    expect(s3SendMock).toHaveBeenCalledTimes(1);
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('verified at startup') })
    );
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('logs a loud, non-secret diagnostic error when the startup self-check fails (e.g. invalid credentials)', async () => {
    const awsErr: any = new Error('The AWS Access Key Id you provided does not exist in our records.');
    awsErr.name = 'InvalidAccessKeyId';
    awsErr.$metadata = { httpStatusCode: 403 };
    s3SendMock.mockRejectedValue(awsErr);

    await import('../../src/routes/uploads');
    await new Promise(process.nextTick);

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('FAILED startup verification'),
        awsErrorName: 'InvalidAccessKeyId',
        awsHttpStatus: 403,
        bucket: 'test-bucket',
      })
    );
    // Never leak the actual credential values -- only safe metadata.
    const loggedCall = loggerErrorMock.mock.calls[0][0];
    expect(JSON.stringify(loggedCall)).not.toContain('test-access-key');
    expect(JSON.stringify(loggedCall)).not.toContain('test-secret-key');
  });

  it('does not run the self-check (or construct an S3 client) when AWS is not configured', async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_S3_BUCKET;
    await import('../../src/routes/uploads');
    await new Promise(process.nextTick);

    expect(s3SendMock).not.toHaveBeenCalled();
  });

  it('warns at startup if a custom endpoint is configured but S3_PUBLIC_URL_BASE is not', async () => {
    // A custom endpoint (R2, etc.) with valid credentials would still
    // silently store an unusable image URL without this -- see
    // publicUrlFor's comment in uploads.ts. This should be caught loudly
    // at boot, not discovered later as "upload succeeded, image 404s."
    process.env.S3_ENDPOINT = 'https://example-account-id.r2.cloudflarestorage.com';
    delete process.env.S3_PUBLIC_URL_BASE;
    s3SendMock.mockResolvedValue({});

    await import('../../src/routes/uploads');
    await new Promise(process.nextTick);

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('S3_PUBLIC_URL_BASE is not') })
    );
  });

  it('does not warn when a custom endpoint has S3_PUBLIC_URL_BASE configured', async () => {
    process.env.S3_ENDPOINT = 'https://example-account-id.r2.cloudflarestorage.com';
    process.env.S3_PUBLIC_URL_BASE = 'https://pub-example.r2.dev';
    s3SendMock.mockResolvedValue({});

    await import('../../src/routes/uploads');
    await new Promise(process.nextTick);

    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('does not warn for real AWS S3 (no custom endpoint) even without S3_PUBLIC_URL_BASE', async () => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_PUBLIC_URL_BASE;
    s3SendMock.mockResolvedValue({});

    await import('../../src/routes/uploads');
    await new Promise(process.nextTick);

    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  describe('publicUrlFor', () => {
    it('builds the URL from S3_PUBLIC_URL_BASE + the file key when configured', async () => {
      process.env.S3_PUBLIC_URL_BASE = 'https://pub-example.r2.dev/';
      const { publicUrlFor } = await import('../../src/routes/uploads');

      expect(publicUrlFor({ key: 'listings/abc.jpg', location: 'https://private-endpoint/whatever' } as any))
        .toBe('https://pub-example.r2.dev/listings/abc.jpg');
    });

    it('falls back to file.location (the AWS SDK-computed URL) when S3_PUBLIC_URL_BASE is not set', async () => {
      delete process.env.S3_PUBLIC_URL_BASE;
      const { publicUrlFor } = await import('../../src/routes/uploads');

      expect(publicUrlFor({ key: 'listings/abc.jpg', location: 'https://real-aws-bucket.s3.amazonaws.com/listings/abc.jpg' } as any))
        .toBe('https://real-aws-bucket.s3.amazonaws.com/listings/abc.jpg');
    });
  });
});
