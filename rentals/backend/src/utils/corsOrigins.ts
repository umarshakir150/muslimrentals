// Netlify Deploy Preview / branch-deploy origin matching -- see index.ts for
// how this is wired into Express's and Socket.IO's CORS config. Split out
// into its own module (rather than living inline in index.ts, which has
// top-level side effects like validateEnv() and server.listen()) so it can
// be unit tested directly.
//
// Netlify serves every PR preview and branch deploy of a site at a distinct
// origin shaped <deploy-id-or-branch>--<site-name>.netlify.app -- a
// different hostname per preview, so an exact-match allowlist can never
// enumerate them all (and manually re-adding a Render env var for every PR
// would defeat the point of a preview workflow). Derive the site name from
// whichever configured production origin is itself a *.netlify.app URL, and
// allow only THAT site's own preview subdomains -- this only ever widens
// trust to previews of this exact site, never to any other Netlify-hosted
// site, and does nothing at all for non-Netlify deployments (e.g.
// FRONTEND_URL=http://localhost:3000 in dev never matches).
export function makeNetlifyPreviewOriginMatcher(configuredOrigins: string[]): ((origin: string) => boolean) | null {
  for (const configured of configuredOrigins) {
    const site = /^https:\/\/([a-z0-9-]+)\.netlify\.app$/i.exec(configured)?.[1];
    if (site) {
      const previewOriginRe = new RegExp(`^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?--${site}\\.netlify\\.app$`, 'i');
      return (origin: string) => previewOriginRe.test(origin);
    }
  }
  return null;
}

export function makeOriginChecker(configuredOrigins: string[]): (origin: string) => boolean {
  const isNetlifyPreviewOrigin = makeNetlifyPreviewOriginMatcher(configuredOrigins);
  return (origin: string) => configuredOrigins.includes(origin) || (isNetlifyPreviewOrigin?.(origin) ?? false);
}
