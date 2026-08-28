/**
 * Bounded Product/Security "look at what's already built and find candidate
 * improvements" signal source — the one signal source that costs a real
 * Claude call, so unlike signalSources.ts's local sources it is opt-in
 * (cycle.ts only runs it when `includeDeepSignals` is set) rather than run
 * unconditionally every cycle. Reuses the existing Designer/Security roles
 * and their already-defined `AgentAnalysis` structured output — no new
 * Claude-facing schema needed. Read-only: same registry tool profile
 * (Read/Grep/Glob, no Bash for Designer; Read/Grep/Glob/scoped-Bash for
 * Security) as a normal task-review call, so this can only ever produce
 * candidate findings, never modify anything (PART 2: "Do not allow an
 * autonomous discovery pass to perform destructive security testing").
 */
import { AgentAnalysis as AgentAnalysisSchema, JsonSchemas } from '../types/schemas.js';
import type { AgentRole } from '../types/schemas.js';
import { getProfile } from '../agents/registry.js';
import { buildContext, renderSystemPrompt, renderUserPrompt } from '../context/contextBuilder.js';
import type { ClaudeInvoker } from '../claude/claudeAdapter.js';
import { REPO_ROOT } from '../paths.js';
import type { SignalSource } from './signalSources.js';
import type { RecordSignalInput } from './signalStore.js';
import type { BacklogCategory } from './types.js';

function categoryFor(role: AgentRole): BacklogCategory {
  return role === 'security' ? 'SECURITY' : 'UX';
}

const FOCUS_INSTRUCTION = (role: 'designer' | 'security') =>
  role === 'designer'
    ? 'You are doing a bounded backlog-discovery pass, not implementing anything — this is read-only. Inspect the existing implemented flows in rentals/frontend (pick a small, specific area — e.g. one page or one component tree, not the whole app) and identify concrete, evidence-based UX/product gaps: missing loading/empty/error states, inconsistent patterns versus similar existing flows, obvious accessibility gaps. Each finding must cite a specific file/location. Do not propose a full redesign or invent speculative features — only gaps in what already exists. Respond with ONLY the JSON object matching the required AgentAnalysis schema.'
    : 'You are doing a bounded backlog-discovery pass, not a penetration test — this is read-only, non-destructive inspection only. Inspect a small, specific area of rentals/backend/src/routes (pick one or two route files, not the whole app) for concrete, evidence-based candidate issues: missing ownership checks, missing input validation, inconsistent patterns versus similar existing routes. Do not run any exploit, do not attempt to access or modify data, do not run any destructive or load-generating command. Each finding must cite a specific file/location. Respond with ONLY the JSON object matching the required AgentAnalysis schema.';

/** One bounded, read-only Designer or Security pass over the real repo,
 * converted into candidate signals. `objectiveHint` frames what area to
 * look at (e.g. the standing objective text) — the role itself still
 * decides the specific file(s), same as any other analysis call. */
export function deepSignalSource(invoker: ClaudeInvoker, role: 'designer' | 'security', objectiveHint: string): SignalSource {
  return {
    name: `deep_${role}`,
    async collect(): Promise<RecordSignalInput[]> {
      const profile = getProfile(role);
      const bundle = buildContext({ role, objective: objectiveHint });
      const systemPromptAddition = renderSystemPrompt(bundle);
      const userPrompt = renderUserPrompt(bundle, FOCUS_INSTRUCTION(role));

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

      const parsed = AgentAnalysisSchema.safeParse({ ...(result.json as Record<string, unknown>), role, taskId: 'deep-signal-scan' });
      if (!parsed.success) return [];

      return parsed.data.findings.map((f) => ({
        source: `deep_${role}`,
        type: `${role}_candidate_finding`,
        category: categoryFor(role),
        severity: f.severity === 'critical' ? 5 : f.severity === 'high' ? 4 : f.severity === 'medium' ? 2 : 1,
        confidence: 0.6,
        evidence: f.recommendedAction ? `${f.finding} — ${f.recommendedAction}` : f.finding,
        location: f.evidence,
      }));
    },
  };
}
