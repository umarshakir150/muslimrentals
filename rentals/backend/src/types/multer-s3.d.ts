// No @types/multer-s3 package exists (verified: not present under
// node_modules/@types). Declares just enough of multer-s3's public API
// (v3.0.1, CommonJS module — see node_modules/multer-s3/index.js) for this
// app's usage: the storage-engine factory, its `AUTO_CONTENT_TYPE` static,
// and the file shape multer-s3 attaches to `req.file`/`req.files`
// (see express-multer-s3.d.ts for that part).
//
// This file must stay a global script (no top-level import/export outside
// the `declare module` block) -- if it were a module itself, `declare
// module 'multer-s3'` would be parsed as an *augmentation* of the untyped
// module TS resolves from node_modules, which TS rejects (TS2665: "cannot
// augment an untyped module"). Imports live inside the block instead,
// which is valid and keeps this file itself un-modular.
declare module 'multer-s3' {
  import { StorageEngine } from 'multer';
  import { Request } from 'express';
  import { S3Client } from '@aws-sdk/client-s3';

  interface Options {
    s3: S3Client;
    bucket: string | ((req: Request, file: Express.Multer.File, cb: (error: any, bucket?: string) => void) => void);
    acl?: string | ((req: Request, file: Express.Multer.File, cb: (error: any, acl?: string) => void) => void);
    // Runtime (index.js S3Storage constructor) throws a TypeError unless
    // this is a function or undefined -- a string value type-checks but
    // crashes at construction time, so it is deliberately NOT part of this
    // type (this app always passes multerS3.AUTO_CONTENT_TYPE, a function).
    contentType?: (req: Request, file: Express.Multer.File, cb: (error: any, mime?: string) => void) => void;
    key?: (req: Request, file: Express.Multer.File, cb: (error: any, key?: string) => void) => void;
    metadata?: (req: Request, file: Express.Multer.File, cb: (error: any, metadata?: Record<string, string>) => void) => void;
  }

  function multerS3(options: Options): StorageEngine;

  namespace multerS3 {
    const AUTO_CONTENT_TYPE: (req: Request, file: Express.Multer.File, cb: (error: any, mime?: string) => void) => void;
    const DEFAULT_CONTENT_TYPE: (req: Request, file: Express.Multer.File, cb: (error: any, mime?: string) => void) => void;
  }

  export = multerS3;
}
