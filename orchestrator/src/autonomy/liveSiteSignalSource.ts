/**
 * Bounded, opt-in QA pass against the real published site
 * (https://muslimrentals.netlify.app/) — the live-product signal source
 * required by ai/operating-directive.md ("Live product as a signal
 * source") and agents/qa.md ("Live product review"). Mirrors
 * deepSignalSource.ts's shape exactly: reuses the existing `qa` role and
 * its already-defined `AgentAnalysis` structured output rather than
 * inventing a new Claude-facing schema, and costs a real Claude call (plus
 * real WebFetch requests to the live origin) so cycle.ts only runs it when
 * explicitly opted in — never unconditionally every cycle.
 *
 * QA's registry profile (src/agents/registry.ts) scopes its WebFetch grant
 * to `WebFetch(domain:muslimrentals.netlify.app)` only — this source
 * cannot fetch arbitrary external URLs even if the model tried.
 *
 * Read-only by construction: QA has no Write/Edit tool, so this can only
 * ever produce candidate findings, never modify anything.
 */
import { AgentAnalysis as AgentAnalysisSchema, JsonSchemas } from '../types/schemas.js';
import { getProfile } from '../agents/registry.js';
import { buildContext, renderSystemPrompt, renderUserPrompt } from '../context/contextBuilder.js';
import type { ClaudeInvoker } from '../claude/claudeAdapter.js';
import { REPO_ROOT } from '../paths.js';
import type { SignalSource } from './signalSources.js';
import { categoryForFindingText } from './signalSources.js';
import type { RecordSignalInput } from './signalStore.js';

const LIVE_SITE_URL = 'https://muslimrentals.netlify.app/';

const FOCUS_INSTRUCTION = `You are doing a bounded live-product review pass against the real published site at ${LIVE_SITE_URL} — this is read-only, non-destructive inspection only (GET/navigation via WebFetch; never submit forms with real data, never attempt to create/modify/delete anything). Pick a small, specific area of the site (e.g. the homepage, browse/filter, one listing detail page, the map, or a static/policy page — not an exhaustive crawl in one pass) and identify concrete, evidence-based problems: broken flows, visual inconsistencies, confusing UX, mobile-unfriendly layout, accessibility gaps, client-side errors, failed requests, a stale deployment (site doesn't reflect what the repo says should be there), missing functionality, internal inconsistency, or content problems.

For each finding, state which of these types it is (put this at the start of the finding text): BROKEN_FLOW, VISUAL_REGRESSION, UX_PROBLEM, MOBILE_PROBLEM, ACCESSIBILITY_PROBLEM, CLIENT_ERROR, FAILED_REQUEST, STALE_DEPLOYMENT, MISSING_FEATURE, INCONSISTENT_BEHAVIOR, PERFORMANCE_CONCERN, or CONTENT_PROBLEM. Cite the exact URL/route and what you actually did (evidence field). Do not speculate about something you did not actually observe — only report what you actually fetched and saw. Respond with ONLY the JSON object matching the required AgentAnalysis schema.`;

/** One bounded, read-only QA pass over the real published site, converted
 * into candidate signals tagged with source `live_site` so downstream
 * consumers can distinguish live-product findings from repo-only ones. */
export function liveSiteSignalSource(invoker: ClaudeInvoker, objectiveHint: string): SignalSource {
  return {
    name: 'live_site',
    async collect(): Promise<RecordSignalInput[]> {
      const role = 'qa' as const;
      const profile = getProfile(role);
      const bundle = buildContext({ role, objective: objectiveHint });
      const systemPromptAddition = renderSystemPrompt(bundle);
      const userPrompt = renderUserPrompt(bundle, FOCUS_INSTRUCTION);

      const result = await invoker.invoke({
        role,
        systemPromptAddition,
        userPrompt,
        cwd: REPO_ROOT,
        jsonSchema: JsonSchemas.AgentAnalysis,
        tools: profile.tools,
        allowedToolPatterns: profile.allowedToolPatterns,
        disallowedToolPatterns: profile.disallowedToolPatterns,
        maxBudgetUsd: profile.maxBudgetUsd,
      });

      const parsed = AgentAnalysisSchema.safeParse({ ...(result.json as Record<string, unknown>), role, taskId: 'live-site-scan' });
      if (!parsed.success) return [];

      return parsed.data.findings.map((f) => ({
        source: 'live_site',
        type: 'live_product_finding',
        category: categoryForFindingText(f.finding),
        severity: f.severity === 'critical' ? 5 : f.severity === 'high' ? 4 : f.severity === 'medium' ? 2 : 1,
        confidence: 0.6,
        evidence: f.recommendedAction ? `${f.finding} — ${f.recommendedAction}` : f.finding,
        location: f.evidence ?? LIVE_SITE_URL,
        metadata: { environment: 'PRODUCTION' as const },
      }));
    },
  };
}
