import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerErrorMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/logger', () => ({
  logger: { error: loggerErrorMock, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { errorHandler } from '../../src/middleware/errorHandler';

function mockReqRes() {
  const req: any = { path: '/api/v1/uploads/listing-images/abc', method: 'POST', ip: '127.0.0.1' };
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json: vi.fn(),
  };
  return { req, res };
}

describe('errorHandler AWS SDK diagnostics', () => {
  beforeEach(() => {
    loggerErrorMock.mockClear();
  });

  it('logs AWS-specific diagnostic metadata (error name, HTTP status, request id) for an AWS SDK error', () => {
    const { req, res } = mockReqRes();
    const awsErr: any = new Error('The AWS Access Key Id you provided does not exist in our records.');
    awsErr.name = 'InvalidAccessKeyId';
    awsErr.$metadata = { httpStatusCode: 403, requestId: 'req-123' };

    errorHandler(awsErr, req, res, vi.fn());

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        awsErrorName: 'InvalidAccessKeyId',
        awsHttpStatus: 403,
        awsRequestId: 'req-123',
      })
    );
  });

  it('still returns the generic client-facing message in production, never the raw AWS error', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { req, res } = mockReqRes();
      const awsErr: any = new Error('The AWS Access Key Id you provided does not exist in our records.');
      awsErr.name = 'InvalidAccessKeyId';
      awsErr.$metadata = { httpStatusCode: 403 };

      errorHandler(awsErr, req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'An unexpected error occurred. Please try again.',
      });
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('does not add AWS metadata for a plain, non-AWS error', () => {
    const { req, res } = mockReqRes();
    errorHandler(new Error('plain failure'), req, res, vi.fn());

    const logged = loggerErrorMock.mock.calls[0][0];
    expect(logged).not.toHaveProperty('awsErrorName');
    expect(logged).not.toHaveProperty('awsHttpStatus');
  });
});
