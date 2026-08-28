// Augments the global Express.Multer.File shape with the fields multer-s3
// (see multer-s3.d.ts) actually attaches to req.file/req.files -- `export
// {}` makes this file a module so `declare global` is valid here (the
// opposite constraint from multer-s3.d.ts, which must stay a script).
export {};

declare global {
  namespace Express {
    namespace MulterS3 {
      interface File extends Express.Multer.File {
        bucket: string;
        key: string;
        acl: string;
        contentType: string;
        location: string;
        etag: string;
        versionId?: string;
      }
    }
  }
}
