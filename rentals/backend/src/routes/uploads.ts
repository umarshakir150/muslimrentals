/**
 * Upload routes
 * OWASP A08 – Software and Data Integrity Failures
 *
 * Security measures:
 *  - MIME type validation via fileFilter (reject non-image types)
 *  - File size limits enforced by multer before data reaches the handler
 *  - Ownership verified before adding images to a listing
 *  - S3 key uses UUID (not original filename) to prevent path traversal
 *  - All AWS credentials come exclusively from environment variables
 *  - uploadRateLimiter limits abuse of the upload endpoint
 *  - File count per listing capped at 10
 */
import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuid } from 'uuid';
import path from 'path';

import { authenticate, AuthRequest } from '../middleware/auth';
import { uploadRateLimiter } from '../middleware/rateLimiter';
import { validateUuidParam } from '../middleware/validateUuid';
import { prisma } from '../prisma/client';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// ─── S3 client — credentials exclusively from env (OWASP A02) ─────────────────
// AWS is optional-with-warning (.env.example / validateEnv.ts): the server
// must still boot without it, with uploads disabled, rather than crash.
// multer-s3's own S3Storage constructor throws synchronously the moment a
// bucket-less instance is created, so both the client and the multer
// instances below are only constructed when fully configured.
const AWS_CONFIGURED = Boolean(
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET
);

const s3 = AWS_CONFIGURED
  ? new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    })
  : null;

// ─── Constants ─────────────────────────────────────────────────────────────────
// OWASP A08: restrict to known-safe image MIME types
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const MAX_FILE_SIZE      = 10 * 1024 * 1024; // 10 MB
const MAX_AVATAR_SIZE    = 5  * 1024 * 1024; //  5 MB
const MAX_FILES          = 10;

// ─── File filter — dual MIME + extension check ─────────────────────────────────
function imageFileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new AppError('Only JPEG, PNG, WEBP, and AVIF images are allowed.', 400));
  }
}

// ─── S3 storage factory ────────────────────────────────────────────────────────
function makeS3Storage(prefix: string) {
  return multerS3({
    s3: s3!,
    bucket: process.env.AWS_S3_BUCKET!,
    acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      // Use UUID key — never trust the original filename (path traversal prevention)
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${prefix}/${uuid()}${ext}`);
    },
  });
}

const listingUpload = AWS_CONFIGURED
  ? multer({ storage: makeS3Storage('listings'), limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES }, fileFilter: imageFileFilter })
  : null;

const avatarUpload = AWS_CONFIGURED
  ? multer({ storage: makeS3Storage('avatars'), limits: { fileSize: MAX_AVATAR_SIZE, files: 1 }, fileFilter: imageFileFilter })
  : null;

// Runs before the underlying multer middleware so an unconfigured server
// returns a clear 503 instead of multer-s3 crashing the process at import
// time (the bug this whole AWS_CONFIGURED guard exists to fix).
function uploadMiddleware(upload: multer.Multer | null, field: string, maxCount?: number) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!upload) return next(new AppError('Image uploads are not configured on this server yet.', 503));
    const handler = maxCount != null ? upload.array(field, maxCount) : upload.single(field);
    handler(req, res, next);
  };
}

// ─── POST /uploads/listing-images/:listingId ──────────────────────────────────
router.post(
  '/listing-images/:listingId',
  validateUuidParam('listingId'),
  authenticate,
  uploadRateLimiter,
  uploadMiddleware(listingUpload, 'images', MAX_FILES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const listing = await prisma.listing.findUnique({ where: { id: req.params.listingId } });
      if (!listing) throw new AppError('Listing not found.', 404);
      if (listing.userId !== req.user!.id) throw new AppError('Not authorized.', 403);

      const files = req.files as Express.MulterS3.File[];
      if (!files?.length) throw new AppError('No files uploaded.', 400);

      // Check total image count to enforce cap
      const existing = await prisma.listingImage.count({ where: { listingId: listing.id } });
      if (existing + files.length > MAX_FILES) {
        throw new AppError(`A listing can have at most ${MAX_FILES} images.`, 400);
      }

      const images = await prisma.$transaction(
        files.map((file, i) =>
          prisma.listingImage.create({
            data: { listingId: listing.id, url: file.location, key: file.key, order: existing + i },
          })
        )
      );

      res.json({ success: true, data: images });
    } catch (err) { next(err); }
  }
);

// ─── POST /uploads/avatar ─────────────────────────────────────────────────────
router.post(
  '/avatar',
  authenticate,
  uploadRateLimiter,
  uploadMiddleware(avatarUpload, 'avatar'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const file = req.file as Express.MulterS3.File;
      if (!file) throw new AppError('No file uploaded.', 400);

      await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl: file.location } });
      res.json({ success: true, data: { url: file.location } });
    } catch (err) { next(err); }
  }
);

// ─── DELETE /uploads/listing-images/:imageId ──────────────────────────────────
router.delete(
  '/listing-images/:imageId',
  validateUuidParam('imageId'),
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const image = await prisma.listingImage.findUnique({
        where:   { id: req.params.imageId },
        include: { listing: true },
      });
      if (!image) throw new AppError('Image not found.', 404);
      if (image.listing.userId !== req.user!.id) throw new AppError('Not authorized.', 403);
      if (!s3) throw new AppError('Image uploads are not configured on this server yet.', 503);

      await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET!, Key: image.key }));
      await prisma.listingImage.delete({ where: { id: image.id } });

      res.json({ success: true, message: 'Image deleted.' });
    } catch (err) { next(err); }
  }
);

export default router;
