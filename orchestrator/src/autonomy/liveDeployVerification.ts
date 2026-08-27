/**
 * Post-production-merge live verification — the QA half of
 * ai/operating-directive.md "Production deploy policy": after a reviewed
 * change is merged and pushed to the real production branch, confirm the
 * live site at https://muslimrentals.netlify.app/ actually picked it up
 * and the changed feature works, before calling the loop closed.
 *
 * Honesty is the entire point of this module (see agents/qa.md
 * "Verification-level honesty"): `reachable: false` means the live site
 * could not be reached at all (network/proxy failure, Netlify still
 * building, DNS, etc.) — that is NOT a regression and must never be
 * reported as one. Only `reachable: true, verified: false` is a real,
 * actionable live-site problem. A network failure genuinely happened in
 * this project's own sandboxed environment (see orchestrator/README.md
 * "Production deploy policy" — a confirmed proxy egress denial for this
 * exact domain) — this module has to handle that as an expected, sober
 * outcome, not an exception to work around.
 */
import { AgentAnalysis as AgentAnalysisSchema, JsonSchemas } from '../types/schemas.js';
import { getProfile } from '../agents/registry.js';
import { buildContext, renderSystemPrompt, renderUserPrompt } from '../context/contextBuilder.js';
import type { ClaudeInvoker } from '../claude/claudeAdapter.js';
import { REPO_ROOT } from '../paths.js';

const LIVE_SITE_URL = 'https://muslimrentals.netlify.app/';

export interface LiveVerificationResult {
  /** True only if the live site was actually reached AND the change was confirmed working. */
  verified: boolean;
  /** False if the site could not be reached at all — distinguishes "broken" from "unknown". */
  reachable: boolean;
  summary: string;
  findings: string[];
}

/**
 * One bounded QA pass confirming a specific, just-deployed change is live
 * and working. `whatChanged` should name the concrete thing to check
 * (e.g. "the /saved page now exists and shows a signed-in user's saved
 * listings" ) — this is a targeted regression check against one recent
 * change, not a general site crawl (that's liveSiteSignalSource.ts's job).
 */
export async function verifyLiveDeploy(invoker: ClaudeInvoker, whatChanged: string, productionSha: string): Promise<LiveVerificationResult> {
  const role = 'qa' as const;
  const profile = getProfile(role);
  const objective = `Verify a just-deployed production change is live and working: ${whatChanged}`;
  const bundle = buildContext({ role, objective });
  const systemPromptAddition = renderSystemPrompt(bundle);
  const instruction = `A change was just merged and pushed to the production branch (commit ${productionSha}) and should now be live at ${LIVE_SITE_URL} once Netlify finishes building. Using WebFetch, check whether the live site reflects this specific change: ${whatChanged}. This is read-only verification only — never submit forms with real data. If the fetch itself fails or times out (network/proxy issue, DNS, Netlify still mid-deploy), report that plainly as a fetch failure — do NOT guess or assume the feature works or is broken; that is a fundamentally different outcome from actually observing it live. Respond with ONLY the JSON object matching the required AgentAnalysis schema: put "REACHABLE" or "UNREACHABLE" as the first word of your summary, then whether the specific change was confirmed.`;
  const userPrompt = renderUserPrompt(bundle, instruction);

  let invokeResult;
  try {
    invokeResult = await invoker.invoke({
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
  } catch (err) {
    // The invoker/worker process itself failed (e.g. network egress denied
    // before the model could even respond) — genuinely unreachable, not a
    // model judgment call.
    return {
      verified: false,
      reachable: false,
      summary: `Could not run the live verification check at all: ${err instanceof Error ? err.message : String(err)}`,
      findings: [],
    };
  }

  const parsed = AgentAnalysisSchema.safeParse({ ...(invokeResult.json as Record<string, unknown>), role, taskId: 'live-deploy-verification' });
  if (!parsed.success) {
    return { verified: false, reachable: false, summary: 'Live verification response failed schema validation — treated as unverified, not as a pass.', findings: [] };
  }

  const summaryUpper = parsed.data.summary.toUpperCase();
  const reachable = summaryUpper.includes('REACHABLE') && !summaryUpper.startsWith('UNREACHABLE') && !summaryUpper.includes('UNREACHABLE');
  const findings = parsed.data.findings.map((f) => f.finding);
  const verified = reachable && parsed.data.findings.length === 0;

  return { verified, reachable, summary: parsed.data.summary, findings };
}
