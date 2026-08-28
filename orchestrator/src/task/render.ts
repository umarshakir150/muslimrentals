/**
 * Renders structured artifacts (validated against src/types/schemas.ts) to
 * the human-readable markdown files the task spec asks for
 * (designer.md, legal.md, trust-safety.md, engineering-plan.md,
 * final-report.md). qa.json/security.json are stored as raw JSON instead —
 * see taskStore.ts — since ReviewResult is consumed by the state machine
 * as much as by a human reader.
 */
import type {
  AgentAnalysis,
  FinalTaskReport,
  Finding,
  ImplementationResult,
  IntegrationResult,
} from '../types/schemas.js';

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) return '_No findings._';
  return findings
    .map((f, i) => {
      const lines = [`${i + 1}. **[${f.severity.toUpperCase()}]** ${f.finding}`];
      if (f.evidence) lines.push(`   - Evidence: ${f.evidence}`);
      if (f.recommendedAction) lines.push(`   - Recommended action: ${f.recommendedAction}`);
      return lines.join('\n');
    })
    .join('\n');
}

export function renderRequestMd(params: { taskId: string; objective: string; mode: 'dry_run' | 'full'; createdAt: string }): string {
  return [
    `# Task request`,
    ``,
    `- **Task ID:** ${params.taskId}`,
    `- **Mode:** ${params.mode === 'dry_run' ? 'DRY RUN (planning only, no implementation)' : 'FULL (implementation authorized)'}`,
    `- **Created:** ${params.createdAt}`,
    ``,
    `## Objective`,
    ``,
    params.objective,
    ``,
  ].join('\n');
}

export function renderAgentAnalysisMd(a: AgentAnalysis): string {
  return [
    `# ${a.role} analysis`,
    ``,
    `**Task:** ${a.taskId}`,
    ``,
    `## Summary`,
    ``,
    a.summary,
    ``,
    `## Findings`,
    ``,
    renderFindings(a.findings),
    ``,
    `## Open questions`,
    ``,
    a.openQuestions.length ? a.openQuestions.map((q) => `- ${q}`).join('\n') : '_None._',
    ``,
    `## Recommendation`,
    ``,
    a.recommendation,
    ``,
  ].join('\n');
}

export function renderImplementationMd(r: ImplementationResult): string {
  return [
    `# Engineering implementation result`,
    ``,
    `**Task:** ${r.taskId}`,
    `**Branch:** ${r.branch}`,
    `**No changes needed:** ${r.noChangesNeeded ? 'yes' : 'no'}`,
    ``,
    `## Summary`,
    ``,
    r.summary,
    ``,
    `## Files changed`,
    ``,
    r.filesChanged.length ? r.filesChanged.map((f) => `- ${f}`).join('\n') : '_None._',
    ``,
    `## Test plan`,
    ``,
    r.testPlan,
    ``,
    `## Self-check notes`,
    ``,
    r.selfCheckNotes.length ? r.selfCheckNotes.map((n) => `- ${n}`).join('\n') : '_None._',
    ``,
  ].join('\n');
}

export function renderIntegrationMd(r: IntegrationResult): string {
  return [
    `# Integration report`,
    ``,
    `**Task:** ${r.taskId}`,
    `**Integration branch:** ${r.branch}`,
    `**Unresolved conflicts:** ${r.unresolvedConflicts.length ? '⚠ YES — see below' : 'None'}`,
    ``,
    `## Summary`,
    ``,
    r.summary,
    ``,
    `## Reconciliation decisions`,
    ``,
    r.decisions.length
      ? r.decisions
          .map(
            (d, i) =>
              `${i + 1}. **${d.path}** — chose: ${d.chosenSource}${d.combined ? ' (combined with another implementer\'s change)' : ''}\n   - Rationale: ${d.rationale}${d.behaviorChanged ? `\n   - Behavior changed: ${d.behaviorChanged}` : ''}`
          )
          .join('\n')
      : '_No reconciliation decisions were needed — branches merged cleanly with no overlapping or out-of-scope changes._',
    ``,
    `## Files changed (integrated worktree)`,
    ``,
    r.filesChanged.length ? r.filesChanged.map((f) => `- ${f}`).join('\n') : '_None._',
    ``,
    `## Unresolved conflicts`,
    ``,
    r.unresolvedConflicts.length ? r.unresolvedConflicts.map((c) => `- ${c}`).join('\n') : '_None._',
    ``,
  ].join('\n');
}

export function renderFinalReportMd(r: FinalTaskReport): string {
  return [
    `# Final task report`,
    ``,
    `- **Task ID:** ${r.taskId}`,
    `- **Final state:** ${r.finalState}`,
    `- **Agents involved:** ${r.agentsInvolved.join(', ')}`,
    `- **Correction cycles used:** ${r.correctionCycles}`,
    `- **QA verdict:** ${r.qaVerdict ?? 'N/A'}`,
    `- **Security verdict:** ${r.securityVerdict ?? 'N/A'}`,
    ``,
    `## Objective`,
    ``,
    r.objective,
    ``,
    `## Founder approval gate`,
    ``,
    r.approvalGate.required
      ? `**FOUNDER_APPROVAL_REQUIRED**\n\n${r.approvalGate.reasons.map((x) => `- ${x}`).join('\n')}`
      : 'Not required for this task.',
    ``,
    `## Summary`,
    ``,
    r.summary,
    ``,
    `## Files changed`,
    ``,
    r.filesChanged.length ? r.filesChanged.map((f) => `- ${f}`).join('\n') : '_None (dry run or analysis-only task)._',
    ``,
    `## Next steps`,
    ``,
    r.nextSteps.length ? r.nextSteps.map((n) => `- ${n}`).join('\n') : '_None._',
    ``,
  ].join('\n');
}
