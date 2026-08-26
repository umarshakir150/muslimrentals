/**
 * The core state machine: PLANNING -> ... -> COMPLETE / FOUNDER_APPROVAL_REQUIRED / ABORTED.
 *
 * Architectural rule this file exists to enforce (per the task that created
 * it): Supervisor -> specialized workers -> structured outputs -> Supervisor
 * aggregation -> implementation -> independent review -> correction loop.
 * Agents never talk to each other directly or hold a free-form conversation
 * — every hand-off is a structured artifact (src/types/schemas.ts) written
 * to ai/tasks/<id>/ (src/task/taskStore.ts) and read back as context
 * (src/context/contextBuilder.ts) by whatever runs next.
 *
 * Two distinct review paths, chosen by how many implementer roles ran:
 *
 *  - Exactly one implementer -> QA_REVIEW / SECURITY_REVIEW / RE_REVIEW.
 *    There is only one worktree; nothing to cross-check it against.
 *  - Two or more implementers -> CROSS_BRANCH_ANALYSIS / INTEGRATION /
 *    INTEGRATED_QA_REVIEW / INTEGRATED_SECURITY_REVIEW / RE_INTEGRATION.
 *    This exists because a real run (see ai/tasks/20260825-053836-...)
 *    proved that reviewing each implementer's worktree in isolation lets
 *    two branches diverge on the same file and BOTH pass review — nothing
 *    ever looked at the combined result. Per-implementer review no longer
 *    happens at all in this path; only the integrated worktree is reviewed,
 *    and only that verdict counts toward COMPLETE.
 */
import type {
  AgentRole,
  AgentAnalysis,
  FinalTaskReport,
  ImplementationResult,
  IntegrationResult,
  OverlapReport,
  ReviewResult,
  SupervisorPlan,
  TaskState,
  WorkerChangeSet,
} from '../types/schemas.js';
import {
  AgentAnalysis as AgentAnalysisSchema,
  ImplementationResult as ImplementationResultSchema,
  IntegrationResult as IntegrationResultSchema,
  OverlapReport as OverlapReportSchema,
  ReviewResult as ReviewResultSchema,
  SupervisorPlan as SupervisorPlanSchema,
  JsonSchemas,
} from '../types/schemas.js';
import type { ClaudeInvoker } from '../claude/claudeAdapter.js';
import { getProfile, isImplementerRole } from '../agents/registry.js';
import { buildContext, renderSystemPrompt, renderUserPrompt, type PrerequisiteArtifact } from '../context/contextBuilder.js';
import { buildPlan, DEFAULT_MAX_AGENTS_PER_TASK, GROUP_1_SPECIALISTS } from './planner.js';
import { analyzeCrossBranch, allChangedPaths, defaultScopes } from './crossBranchAnalysis.js';
import { mapConcurrent } from './concurrency.js';
import {
  addWorktreeForExistingBranch,
  commitAll,
  commitMerge,
  createIntegrationWorktree,
  createWorktree,
  diffNameStatus,
  existingWorktreeHandle,
  mergeBaseOf,
  mergeBranch,
  resolveHead,
  unresolvedConflicts,
  type WorktreeHandle,
} from '../git/worktree.js';
import { generateTaskId } from '../task/taskId.js';
import { readArtifact, writeArtifact, writeJsonArtifact } from '../task/taskStore.js';
import {
  renderRequestMd,
  renderAgentAnalysisMd,
  renderImplementationMd,
  renderIntegrationMd,
  renderFinalReportMd,
} from '../task/render.js';
import { logEvent } from '../logger.js';
import { REPO_ROOT } from '../paths.js';

export const DEFAULT_MAX_RETRY_CYCLES = 2;
export const DEFAULT_MAX_CONCURRENCY = 4;

export interface RunOptions {
  objective: string;
  mode: 'dry_run' | 'full';
  invoker: ClaudeInvoker;
  maxAgentsPerTask?: number;
  maxRetryCycles?: number;
  maxConcurrency?: number;
  /** Injectable for tests; defaults to a timestamp+slug id. */
  taskId?: string;
}

export interface RunResult {
  taskId: string;
  finalState: TaskState;
  plan: SupervisorPlan;
  finalReport: FinalTaskReport;
  /** role -> worktree handle, for anything the orchestrator implemented in. Empty for dry runs. */
  worktrees: Record<string, WorktreeHandle>;
  /** Set only when 2+ implementers ran and integration actually happened. */
  integrationWorktree?: WorktreeHandle;
}

const ANALYSIS_INSTRUCTION =
  'Respond with ONLY the JSON object matching the required AgentAnalysis schema — no prose, no markdown fences outside the JSON. "recommendation" must be a clear, actionable recommendation for the Supervisor and Engineering Lead.';

const DRY_RUN_ENGINEERING_INSTRUCTION =
  'This is a DRY RUN. Do NOT write or edit any files — you do not have Write/Edit tools in this session. Produce a consolidated technical analysis only: what would need to change, roughly which areas/files, migration/regression risk, and a Frontend/Backend split if relevant. Respond with ONLY the JSON object matching the required AgentAnalysis schema — no prose, no markdown fences.';

const IMPLEMENTATION_INSTRUCTION =
  'You are working inside an isolated git worktree/branch that already exists and is checked out — only make changes here, never `git checkout` elsewhere. When you are done (or have determined no code change is needed), respond with ONLY the JSON object matching the required ImplementationResult schema — no prose, no markdown fences. Set "branch" to the current git branch (`git branch --show-current` if unsure). Do not worry about committing — the orchestrator commits your worktree automatically after you respond.';

function reviewInstruction(role: 'qa' | 'security'): string {
  const verdictWord = role === 'qa' ? 'PASS' : 'APPROVED';
  return (
    `Independently review the changes in this worktree — do not trust any prior summary, inspect the actual diff/code yourself with your Read/Grep/Glob/Bash tools. ` +
    `Respond with ONLY the JSON object matching the required ReviewResult schema — no prose, no markdown fences. "verdict" must be exactly "${verdictWord}" or "CHANGES_REQUIRED".`
  );
}

function renderCorrectionFeedback(qa?: ReviewResult, security?: ReviewResult): string {
  const parts: string[] = [];
  if (qa && qa.verdict === 'CHANGES_REQUIRED') {
    parts.push(`### QA findings\n\n${qa.findings.map((f) => `- [${f.severity}] ${f.finding}${f.recommendedAction ? ` — fix: ${f.recommendedAction}` : ''}`).join('\n')}`);
  }
  if (security && security.verdict === 'CHANGES_REQUIRED') {
    parts.push(`### Security findings\n\n${security.findings.map((f) => `- [${f.severity}] ${f.finding}${f.recommendedAction ? ` — fix: ${f.recommendedAction}` : ''}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

function integratorInstruction(overlapReport: OverlapReport, remainingBranches: string[], correctionFeedback?: string): string {
  const parts = [
    'You are reconciling multiple implementers\' branches into one integrated worktree, which is already checked out here. Some branches may already be merged cleanly; you may be starting mid-conflict on one of them.',
    `Deterministic cross-branch analysis for this task (computed from git, not from any worker's self-report):\n${JSON.stringify(overlapReport, null, 2)}`,
  ];
  if (remainingBranches.length > 0) {
    parts.push(
      `These branches still need to be merged into this worktree (run \`git merge --no-ff <branch>\` yourself for each, resolving conflicts as they come up): ${remainingBranches.join(', ')}`
    );
  }
  parts.push(
    'For every CONFLICTING overlap or OUT_OF_SCOPE_REVIEW_REQUIRED entry above, inspect both implementers\' actual diffs and their own implementation reports (in your context below), decide which version is correct (or combine them), edit the integration worktree accordingly, and record the decision. Resolve any git conflict markers, then `git add -A && git commit` so this worktree ends in a clean, fully committed state. If something genuinely cannot be reconciled, say so explicitly in unresolvedConflicts rather than committing contradictory code or silently picking a side without explanation.'
  );
  if (correctionFeedback) {
    parts.push(`A previous integrated review found issues that still need fixing in this worktree:\n${correctionFeedback}`);
  }
  parts.push('Respond with ONLY the JSON object matching the required IntegrationResult schema — no prose, no markdown fences. Set "branch" to the current git branch.');
  return parts.join('\n\n');
}

class Runner {
  private worktrees = new Map<AgentRole, WorktreeHandle>();
  private specialistArtifacts: PrerequisiteArtifact[] = [];
  private implementationArtifacts: PrerequisiteArtifact[] = [];
  // Ground-truth filesChanged per implementer role, decoupled from
  // implementationArtifacts[].content — that content is prose shown to the
  // Integrator/reviewers and, for a resumed task (resumeFromExistingBranches),
  // is the implementer's original historical markdown report, not JSON.
  private implementerFilesByRole = new Map<AgentRole, string[]>();
  private agentsInvolved = new Set<AgentRole>();
  private correctionCycles = 0;
  private finalQaResult: ReviewResult | undefined;
  private finalSecurityResult: ReviewResult | undefined;
  private baseCommit: string | undefined;
  private overlapReport: OverlapReport | undefined;
  private integrationWorktree: WorktreeHandle | undefined;
  private integrationResult: IntegrationResult | undefined;

  constructor(
    private readonly taskId: string,
    private readonly objective: string,
    private readonly mode: 'dry_run' | 'full',
    private readonly invoker: ClaudeInvoker,
    private readonly maxRetryCycles: number,
    private readonly maxConcurrency: number
  ) {}

  private setState(state: TaskState): void {
    logEvent({ taskId: this.taskId, event: 'state_transition', state });
  }

  private async runAnalysisAgent(role: AgentRole, opts: { instruction: string; forceReadOnly?: boolean }): Promise<AgentAnalysis> {
    const profile = getProfile(role);
    const bundle = buildContext({ role, objective: this.objective, prerequisiteArtifacts: this.specialistArtifacts });
    const systemPromptAddition = renderSystemPrompt(bundle);
    const userPrompt = renderUserPrompt(bundle, opts.instruction);

    logEvent({ taskId: this.taskId, event: 'agent_launch', role });
    this.agentsInvolved.add(role);

    const invokeResult = await this.invoker.invoke({
      role,
      systemPromptAddition,
      userPrompt,
      cwd: REPO_ROOT,
      jsonSchema: JsonSchemas.AgentAnalysis,
      tools: opts.forceReadOnly ? profile.tools.filter((t) => t !== 'Write' && t !== 'Edit' && t !== 'Bash') : profile.tools,
      allowedToolPatterns: opts.forceReadOnly ? [] : profile.allowedToolPatterns,
      disallowedToolPatterns: opts.forceReadOnly ? [] : profile.disallowedToolPatterns,
      maxBudgetUsd: profile.maxBudgetUsd,
    });

    const parsed = AgentAnalysisSchema.safeParse({ ...(invokeResult.json as Record<string, unknown>), role, taskId: this.taskId });
    const analysis: AgentAnalysis = parsed.success
      ? parsed.data
      : {
          role,
          taskId: this.taskId,
          summary: 'Output failed schema validation.',
          findings: [],
          openQuestions: ['Raw output did not match AgentAnalysis schema — see log.jsonl for the raw payload.'],
          recommendation: 'Re-run this agent; treat this task as incomplete for this role.',
        };
    if (!parsed.success) {
      logEvent({ taskId: this.taskId, event: 'agent_output_validation_failed', role, issues: parsed.error.issues.map((i) => i.message) });
    }

    const filename = getProfile(role).artifactFilename;
    writeArtifact(this.taskId, filename, renderAgentAnalysisMd(analysis));
    logEvent({ taskId: this.taskId, event: 'agent_complete', role, artifact: filename });
    return analysis;
  }

  private async runSpecialistGroup(roles: AgentRole[]): Promise<void> {
    this.setState('SPECIALIST_REVIEW');
    const results = await mapConcurrent(roles, this.maxConcurrency, (role) => this.runAnalysisAgent(role, { instruction: ANALYSIS_INSTRUCTION }));
    for (let i = 0; i < roles.length; i++) {
      this.specialistArtifacts.push({ role: roles[i] as AgentRole, content: JSON.stringify(results[i]) });
    }
  }

  private async runDryRunEngineeringGroup(roles: AgentRole[]): Promise<void> {
    this.setState('SPECIALIST_REVIEW');
    await mapConcurrent(roles, this.maxConcurrency, (role) => this.runAnalysisAgent(role, { instruction: DRY_RUN_ENGINEERING_INSTRUCTION, forceReadOnly: true }));
  }

  private async runImplementer(role: AgentRole, correctionFeedback?: string): Promise<ImplementationResult> {
    const profile = getProfile(role);
    let worktree = this.worktrees.get(role);
    if (!worktree) {
      worktree = await createWorktree(this.taskId, role, this.baseCommit ?? 'HEAD');
      this.worktrees.set(role, worktree);
      logEvent({ taskId: this.taskId, event: 'worktree_created', role, branch: worktree.branch, path: worktree.path });
    }

    const bundle = buildContext({
      role,
      objective: this.objective,
      prerequisiteArtifacts: this.specialistArtifacts,
      correctionFeedback,
    });
    const systemPromptAddition = renderSystemPrompt(bundle);
    const userPrompt = renderUserPrompt(bundle, IMPLEMENTATION_INSTRUCTION);

    logEvent({ taskId: this.taskId, event: 'agent_launch', role, branch: worktree.branch });
    this.agentsInvolved.add(role);

    const invokeResult = await this.invoker.invoke({
      role,
      systemPromptAddition,
      userPrompt,
      cwd: worktree.path,
      jsonSchema: JsonSchemas.ImplementationResult,
      tools: profile.tools,
      allowedToolPatterns: profile.allowedToolPatterns,
      disallowedToolPatterns: profile.disallowedToolPatterns,
      maxBudgetUsd: profile.maxBudgetUsd,
    });

    const parsed = ImplementationResultSchema.safeParse({ ...(invokeResult.json as Record<string, unknown>), role: 'engineering', taskId: this.taskId, branch: worktree.branch });
    let result: ImplementationResult = parsed.success
      ? { ...parsed.data, role: 'engineering' }
      : {
          role: 'engineering',
          taskId: this.taskId,
          branch: worktree.branch,
          filesChanged: [],
          summary: 'Output failed schema validation.',
          testPlan: 'N/A',
          selfCheckNotes: ['Raw output did not match ImplementationResult schema — see log.jsonl.'],
          noChangesNeeded: false,
        };
    if (!parsed.success) {
      logEvent({ taskId: this.taskId, event: 'agent_output_validation_failed', role, issues: parsed.error.issues.map((i) => i.message) });
    }

    // The orchestrator commits, not the model — never rely on it remembering
    // to. This is also what makes cross-branch analysis/integration possible:
    // there is no reliable diff to merge or compare without real commits.
    try {
      const commitMsg = `${role}: ${result.noChangesNeeded ? 'no changes needed' : (result.summary.split('\n')[0] ?? '').slice(0, 100)}`;
      const commitOutcome = await commitAll(worktree, commitMsg || `${role}: implementation round`);
      if (commitOutcome.committed) {
        logEvent({ taskId: this.taskId, event: 'worktree_committed', role, sha: commitOutcome.sha });
      }
    } catch (err) {
      logEvent({ taskId: this.taskId, event: 'worktree_commit_failed', role, error: String(err) });
    }

    // Ground truth for "what changed" is git, not the model's self-report.
    // Diffed against the task's base commit (not `changedFiles`'s working-
    // tree-only `git status`) because commitAll() just committed everything
    // above — the worktree is clean at this point, so a working-tree status
    // check would report nothing changed even though real commits exist.
    try {
      const actualFiles = allChangedPaths(await diffNameStatus(worktree, this.baseCommit as string));
      result = { ...result, filesChanged: actualFiles };
    } catch (err) {
      logEvent({ taskId: this.taskId, event: 'changed_files_check_failed', role, error: String(err) });
    }

    writeArtifact(this.taskId, profile.artifactFilename, renderImplementationMd(result));
    logEvent({ taskId: this.taskId, event: 'agent_complete', role, artifact: profile.artifactFilename, filesChanged: result.filesChanged.length });

    this.implementationArtifacts.push({ role, content: JSON.stringify(result) });
    this.implementerFilesByRole.set(role, result.filesChanged);
    return result;
  }

  /**
   * One reviewer call against one worktree — either a single implementer's
   * (the 1-implementer path) or the integration worktree (the 2+ path).
   * `targetLabel` is purely for logging/readability; `contextArtifacts` is
   * exactly what this call should be able to see, decided by the caller —
   * scoped to one implementer's own report for the isolated path, or the
   * full picture (every implementer + the integration report) for the
   * integrated path. Does not write any artifact itself — callers do, since
   * the isolated and integrated paths name/aggregate them differently.
   */
  private async invokeReviewer(
    role: 'qa' | 'security',
    targetLabel: string,
    worktreePath: string,
    contextArtifacts: PrerequisiteArtifact[],
    instructionSuffix: string
  ): Promise<ReviewResult> {
    const profile = getProfile(role);
    const bundle = buildContext({
      role,
      objective: this.objective,
      prerequisiteArtifacts: [...this.specialistArtifacts, ...contextArtifacts],
    });
    const systemPromptAddition = renderSystemPrompt(bundle);
    const userPrompt = renderUserPrompt(bundle, `${reviewInstruction(role)} ${instructionSuffix}`);

    logEvent({ taskId: this.taskId, event: 'agent_launch', role, reviewingImplementer: targetLabel });
    this.agentsInvolved.add(role);

    const invokeResult = await this.invoker.invoke({
      role,
      systemPromptAddition,
      userPrompt,
      cwd: worktreePath,
      jsonSchema: JsonSchemas.ReviewResult,
      tools: profile.tools,
      allowedToolPatterns: profile.allowedToolPatterns,
      disallowedToolPatterns: profile.disallowedToolPatterns,
      maxBudgetUsd: profile.maxBudgetUsd,
    });

    const parsed = ReviewResultSchema.safeParse({ ...(invokeResult.json as Record<string, unknown>), role, taskId: this.taskId });
    const result: ReviewResult = parsed.success
      ? parsed.data
      : {
          role,
          taskId: this.taskId,
          verdict: 'CHANGES_REQUIRED',
          findings: [
            {
              severity: 'high',
              finding: 'Reviewer output failed schema validation — treated as a blocking failure rather than silently passing.',
            },
          ],
        };
    if (!parsed.success) {
      logEvent({ taskId: this.taskId, event: 'agent_output_validation_failed', role, reviewingImplementer: targetLabel, issues: parsed.error.issues.map((i) => i.message) });
    }

    logEvent({ taskId: this.taskId, event: 'review_verdict', role, reviewingImplementer: targetLabel, verdict: result.verdict });
    return result;
  }

  // ─── Single-implementer path ────────────────────────────────────────────
  private async runSingleImplementerReviewLoop(
    plan: SupervisorPlan,
    primaryRole: AgentRole,
    reviewerRoles: ('qa' | 'security')[]
  ): Promise<{ finalState: TaskState; report: FinalTaskReport }> {
    const worktree = this.worktrees.get(primaryRole);
    if (!worktree) throw new Error('Internal error: implementer ran without a worktree.');

    let approved = false;
    while (!approved) {
      this.setState(this.correctionCycles === 0 ? 'QA_REVIEW' : 'RE_REVIEW');
      const ownReport = this.implementationArtifacts.filter((a) => a.role === primaryRole);
      const suffix = `You are reviewing ONLY the "${primaryRole}" implementer's worktree — if this task also involved other implementer roles, their work lives in an entirely separate git worktree/branch you cannot see from here. Do not report that another implementer's work "doesn't exist" based on what is or isn't present in this worktree.`;

      const results = await mapConcurrent(reviewerRoles, this.maxConcurrency, (r) =>
        this.invokeReviewer(r, primaryRole, worktree.path, ownReport, suffix)
      );
      reviewerRoles.forEach((r, i) => {
        if (r === 'qa') this.finalQaResult = results[i];
        else this.finalSecurityResult = results[i];
      });
      if (this.finalQaResult) writeJsonArtifact(this.taskId, getProfile('qa').artifactFilename, this.finalQaResult);
      if (this.finalSecurityResult) writeJsonArtifact(this.taskId, getProfile('security').artifactFilename, this.finalSecurityResult);

      const failed = this.finalQaResult?.verdict === 'CHANGES_REQUIRED' || this.finalSecurityResult?.verdict === 'CHANGES_REQUIRED';
      if (!failed) {
        approved = true;
        break;
      }

      this.setState('CORRECTION_REQUIRED');
      if (this.correctionCycles >= this.maxRetryCycles) {
        logEvent({ taskId: this.taskId, event: 'retry_limit_exhausted', correctionCycles: this.correctionCycles, maxRetryCycles: this.maxRetryCycles });
        const report = this.buildFinalReport(plan, 'FOUNDER_APPROVAL_REQUIRED', {
          extraReason: `Correction retry limit (${this.maxRetryCycles}) exhausted — QA/Security still returning CHANGES_REQUIRED. Escalated to founder rather than looping indefinitely.`,
        });
        return { finalState: 'FOUNDER_APPROVAL_REQUIRED', report };
      }

      this.correctionCycles += 1;
      logEvent({ taskId: this.taskId, event: 'correction_cycle_started', cycle: this.correctionCycles });
      const feedback = renderCorrectionFeedback(this.finalQaResult, this.finalSecurityResult);
      this.setState('IMPLEMENTING');
      await this.runImplementer(primaryRole, feedback);
    }

    return this.finishSuccessfully(plan);
  }

  // ─── Multi-implementer path: cross-branch analysis + integration ───────

  /** Sequential mechanical merge of every implementer branch into the integration worktree, stopping at the first conflict. */
  private async performMechanicalMerges(
    integrationWt: WorktreeHandle,
    implementerRoles: AgentRole[]
  ): Promise<{ allClean: boolean; remainingBranches: string[] }> {
    for (let i = 0; i < implementerRoles.length; i++) {
      const role = implementerRoles[i] as AgentRole;
      const wt = this.worktrees.get(role);
      if (!wt) continue;
      const attempt = await mergeBranch(integrationWt, wt.branch);
      if (attempt.clean) {
        await commitMerge(integrationWt, `Merge ${role} (${wt.branch}) into integration`);
        logEvent({ taskId: this.taskId, event: 'integration_merge_clean', role, branch: wt.branch });
      } else {
        logEvent({ taskId: this.taskId, event: 'integration_merge_conflict', role, branch: wt.branch, conflictedFiles: attempt.conflictedFiles });
        const remainingBranches = implementerRoles.slice(i).map((r) => this.worktrees.get(r)?.branch).filter((b): b is string => !!b);
        return { allClean: false, remainingBranches };
      }
    }
    return { allClean: true, remainingBranches: [] };
  }

  private async runIntegrator(
    integrationWt: WorktreeHandle,
    overlapReport: OverlapReport,
    remainingBranches: string[],
    correctionFeedback?: string
  ): Promise<IntegrationResult> {
    const profile = getProfile('integrator');
    const bundle = buildContext({
      role: 'integrator',
      objective: this.objective,
      // The Integrator, unlike QA/Security reviewing one isolated worktree,
      // deliberately gets EVERY implementer's report — reconciling divergent
      // work requires seeing all sides of it.
      prerequisiteArtifacts: [...this.specialistArtifacts, ...this.implementationArtifacts],
    });
    const systemPromptAddition = renderSystemPrompt(bundle);
    const userPrompt = renderUserPrompt(bundle, integratorInstruction(overlapReport, remainingBranches, correctionFeedback));

    logEvent({ taskId: this.taskId, event: 'agent_launch', role: 'integrator' });
    this.agentsInvolved.add('integrator');

    const invokeResult = await this.invoker.invoke({
      role: 'integrator',
      systemPromptAddition,
      userPrompt,
      cwd: integrationWt.path,
      jsonSchema: JsonSchemas.IntegrationResult,
      tools: profile.tools,
      allowedToolPatterns: profile.allowedToolPatterns,
      disallowedToolPatterns: profile.disallowedToolPatterns,
      maxBudgetUsd: profile.maxBudgetUsd,
    });

    const parsed = IntegrationResultSchema.safeParse({ ...(invokeResult.json as Record<string, unknown>), role: 'integrator', taskId: this.taskId, branch: integrationWt.branch });
    let result: IntegrationResult = parsed.success
      ? parsed.data
      : {
          role: 'integrator',
          taskId: this.taskId,
          branch: integrationWt.branch,
          decisions: [],
          filesChanged: [],
          summary: 'Output failed schema validation.',
          unresolvedConflicts: ['Integrator output failed schema validation — treated as unresolved rather than silently accepted.'],
        };
    if (!parsed.success) {
      logEvent({ taskId: this.taskId, event: 'agent_output_validation_failed', role: 'integrator', issues: parsed.error.issues.map((i) => i.message) });
    }

    // Trust but verify: the Integrator claiming success doesn't make it so —
    // check the worktree itself for lingering conflict markers.
    const stillConflicted = await unresolvedConflicts(integrationWt);
    if (stillConflicted.length > 0) {
      result = { ...result, unresolvedConflicts: Array.from(new Set([...result.unresolvedConflicts, ...stillConflicted])) };
      logEvent({ taskId: this.taskId, event: 'integration_still_conflicted', files: stillConflicted });
    }

    // Same reasoning as runImplementer(): diff against the task's base
    // commit, not a working-tree-only `git status`, since the Integrator's
    // own instructions tell it to commit its resolution before responding.
    try {
      const actualFiles = allChangedPaths(await diffNameStatus(integrationWt, this.baseCommit as string));
      result = { ...result, filesChanged: actualFiles };
    } catch (err) {
      logEvent({ taskId: this.taskId, event: 'changed_files_check_failed', role: 'integrator', error: String(err) });
    }

    writeArtifact(this.taskId, getProfile('integrator').artifactFilename, renderIntegrationMd(result));
    logEvent({ taskId: this.taskId, event: 'agent_complete', role: 'integrator', unresolvedConflicts: result.unresolvedConflicts.length });
    this.integrationResult = result;
    return result;
  }

  private async runIntegrationStep(implementerRoles: AgentRole[], overlapReport: OverlapReport, correctionFeedback?: string): Promise<void> {
    this.setState(this.correctionCycles === 0 ? 'INTEGRATION' : 'RE_INTEGRATION');

    if (!this.integrationWorktree) {
      this.integrationWorktree = await createIntegrationWorktree(this.taskId, this.baseCommit as string);
      logEvent({ taskId: this.taskId, event: 'integration_worktree_created', branch: this.integrationWorktree.branch, path: this.integrationWorktree.path });

      const { allClean, remainingBranches } = await this.performMechanicalMerges(this.integrationWorktree, implementerRoles);
      const needsAgent = overlapReport.hasBlockingIssues || !allClean;

      if (!needsAgent) {
        const filesChanged = allChangedPaths(await diffNameStatus(this.integrationWorktree, this.baseCommit as string));
        const result: IntegrationResult = {
          role: 'integrator',
          taskId: this.taskId,
          branch: this.integrationWorktree.branch,
          decisions: [],
          filesChanged,
          summary: `${implementerRoles.length} implementer branch(es) merged cleanly with no overlapping or out-of-scope files — no reconciliation was needed, so no Integrator agent was invoked.`,
          unresolvedConflicts: [],
        };
        writeArtifact(this.taskId, getProfile('integrator').artifactFilename, renderIntegrationMd(result));
        this.integrationResult = result;
        logEvent({ taskId: this.taskId, event: 'integration_mechanical_only', filesChanged: filesChanged.length });
        return;
      }

      await this.runIntegrator(this.integrationWorktree, overlapReport, remainingBranches, correctionFeedback);
      return;
    }

    // Re-integration: the worktree already exists from a prior cycle — fix
    // it in place rather than re-merging from scratch.
    await this.runIntegrator(this.integrationWorktree, overlapReport, [], correctionFeedback);
  }

  private async runIntegratedReviewLoop(
    plan: SupervisorPlan,
    implementerRoles: AgentRole[],
    reviewerRoles: ('qa' | 'security')[]
  ): Promise<{ finalState: TaskState; report: FinalTaskReport }> {
    this.setState('CROSS_BRANCH_ANALYSIS');
    const changeSets: WorkerChangeSet[] = await Promise.all(
      implementerRoles.map(async (role) => {
        const wt = this.worktrees.get(role);
        if (!wt) throw new Error(`Internal error: no worktree for implementer role "${role}".`);
        const diff = await diffNameStatus(wt, this.baseCommit as string);
        return { agent: role, branch: wt.branch, ...diff };
      })
    );
    writeJsonArtifact(this.taskId, 'changed-files.json', { taskId: this.taskId, baseCommit: this.baseCommit, workers: changeSets });
    writeJsonArtifact(this.taskId, 'implementation-scopes.json', plan.implementationScopes);

    const overlapReport = analyzeCrossBranch(this.taskId, changeSets, plan.implementationScopes);
    writeJsonArtifact(this.taskId, 'overlap-report.json', overlapReport);
    this.overlapReport = overlapReport;
    logEvent({
      taskId: this.taskId,
      event: 'cross_branch_analysis_complete',
      overlaps: overlapReport.overlaps.length,
      outOfScope: overlapReport.outOfScope.length,
      hasBlockingIssues: overlapReport.hasBlockingIssues,
    });

    return this.runIntegrationAndReviewLoop(plan, implementerRoles, overlapReport, reviewerRoles);
  }

  /**
   * The shared integration + integrated-review correction loop, used both
   * by the normal path (runIntegratedReviewLoop, right after cross-branch
   * analysis) and by resumeIntegratedReview (skipping straight to review
   * against an integration worktree that's already fully built — see
   * that function for why: a real run had the Integrator genuinely finish
   * reconciling everything QA/Security flagged, but its own retry budget
   * was exhausted by an unrelated tooling gap before a second review ever
   * happened). `opts.alreadyIntegrated` skips the FIRST runIntegrationStep()
   * call (which would otherwise treat an already-complete integration
   * worktree as "existing — fix it in place" and pointlessly re-invoke the
   * Integrator agent) — every subsequent loop iteration (i.e. any actual
   * post-review correction) still calls it normally.
   */
  private async runIntegrationAndReviewLoop(
    plan: SupervisorPlan,
    implementerRoles: AgentRole[],
    overlapReport: OverlapReport,
    reviewerRoles: ('qa' | 'security')[],
    opts: { alreadyIntegrated?: boolean } = {}
  ): Promise<{ finalState: TaskState; report: FinalTaskReport }> {
    let correctionFeedback: string | undefined;
    let approved = false;
    let skipIntegrationStep = opts.alreadyIntegrated === true;

    while (!approved) {
      if (!skipIntegrationStep) {
        await this.runIntegrationStep(implementerRoles, overlapReport, correctionFeedback);
        correctionFeedback = undefined;

        const stepResult = this.integrationResult as IntegrationResult;
        if (stepResult.unresolvedConflicts.length > 0) {
          this.setState('CORRECTION_REQUIRED');
          logEvent({ taskId: this.taskId, event: 'integration_unresolved', unresolvedConflicts: stepResult.unresolvedConflicts });
          if (this.correctionCycles >= this.maxRetryCycles) {
            logEvent({ taskId: this.taskId, event: 'retry_limit_exhausted', correctionCycles: this.correctionCycles, maxRetryCycles: this.maxRetryCycles, reason: 'integration' });
            const report = this.buildFinalReport(plan, 'FOUNDER_APPROVAL_REQUIRED', {
              extraReason: `Correction retry limit (${this.maxRetryCycles}) exhausted — integration could not reach a clean, fully reconciled state (unresolved: ${stepResult.unresolvedConflicts.join('; ')}). Escalated to founder rather than looping indefinitely.`,
            });
            return { finalState: 'FOUNDER_APPROVAL_REQUIRED', report };
          }
          this.correctionCycles += 1;
          correctionFeedback = `Integration left unresolved conflicts: ${stepResult.unresolvedConflicts.join('; ')}. Finish reconciling these before anything else.`;
          continue;
        }
      }
      skipIntegrationStep = false;

      // Re-read from `this.integrationResult` (not a loop-scoped const) —
      // this branch runs whether integration just happened above or was
      // already done before this loop started (resumeIntegratedReview).
      const integrationResult = this.integrationResult as IntegrationResult;
      this.setState('INTEGRATED_QA_REVIEW');
      const integrationArtifact: PrerequisiteArtifact = { role: 'integrator', content: JSON.stringify(integrationResult) };
      const suffix =
        'You are reviewing the INTEGRATED result for this task — this worktree already contains every implementer\'s changes merged and reconciled together (see the Integrator\'s report in your context). Review the actual combined code in this worktree, not just the individual implementer reports; per-worker review is preliminary only, and this integrated review is what determines the final verdict.';

      const results = await mapConcurrent(reviewerRoles, this.maxConcurrency, (r) =>
        this.invokeReviewer(r, 'integration', (this.integrationWorktree as WorktreeHandle).path, [...this.implementationArtifacts, integrationArtifact], suffix)
      );
      reviewerRoles.forEach((r, i) => {
        if (r === 'qa') this.finalQaResult = results[i];
        else this.finalSecurityResult = results[i];
      });
      if (this.finalQaResult) writeJsonArtifact(this.taskId, getProfile('qa').artifactFilename, this.finalQaResult);
      if (this.finalSecurityResult) writeJsonArtifact(this.taskId, getProfile('security').artifactFilename, this.finalSecurityResult);

      const failed = this.finalQaResult?.verdict === 'CHANGES_REQUIRED' || this.finalSecurityResult?.verdict === 'CHANGES_REQUIRED';
      if (!failed) {
        approved = true;
        break;
      }

      this.setState('CORRECTION_REQUIRED');
      if (this.correctionCycles >= this.maxRetryCycles) {
        logEvent({ taskId: this.taskId, event: 'retry_limit_exhausted', correctionCycles: this.correctionCycles, maxRetryCycles: this.maxRetryCycles, reason: 'integrated_review' });
        const report = this.buildFinalReport(plan, 'FOUNDER_APPROVAL_REQUIRED', {
          extraReason: `Correction retry limit (${this.maxRetryCycles}) exhausted — integrated QA/Security still returning CHANGES_REQUIRED. Escalated to founder rather than looping indefinitely.`,
        });
        return { finalState: 'FOUNDER_APPROVAL_REQUIRED', report };
      }
      this.correctionCycles += 1;
      logEvent({ taskId: this.taskId, event: 'correction_cycle_started', cycle: this.correctionCycles });
      correctionFeedback = renderCorrectionFeedback(this.finalQaResult, this.finalSecurityResult);
    }

    return this.finishSuccessfully(plan);
  }

  /**
   * Resumes an already-planned, already-implemented multi-branch task
   * straight into the integration flow, instead of running fresh
   * implementers. For a task whose implementer branches already exist from
   * a prior run (typically one that predates this integration mechanism
   * existing at all) — attaches to each given branch as-is, without
   * creating new commits or new branches, then runs the exact same
   * CROSS_BRANCH_ANALYSIS -> INTEGRATION -> INTEGRATED_QA_REVIEW ->
   * INTEGRATED_SECURITY_REVIEW pipeline a fresh multi-implementer run
   * would. Requires 2+ branches — resuming a single-branch task has
   * nothing to cross-check, same as the normal path.
   */
  async resumeFromExistingBranches(
    plan: SupervisorPlan,
    branchesByRole: Partial<Record<AgentRole, string>>
  ): Promise<{ finalState: TaskState; report: FinalTaskReport }> {
    const implementerRoles = Object.keys(branchesByRole) as AgentRole[];
    const reviewerRoles = plan.requiredAgents.filter((r): r is 'qa' | 'security' => r === 'qa' || r === 'security');

    if (implementerRoles.length < 2) {
      throw new Error('resumeFromExistingBranches requires at least 2 implementer branches — a single branch has nothing to cross-check against.');
    }

    logEvent({ taskId: this.taskId, event: 'resuming_from_existing_branches', branches: branchesByRole });

    // These branches were not necessarily all created from one shared HEAD
    // by this orchestrator (that only became true once createWorktree()
    // started taking a shared baseRef) — the correct base commit is
    // whatever the branches themselves actually share.
    this.baseCommit = await mergeBaseOf(Object.values(branchesByRole) as string[]);
    logEvent({ taskId: this.taskId, event: 'base_commit_resolved', baseCommit: this.baseCommit, method: 'merge-base of existing branches' });

    for (const role of implementerRoles) {
      const branch = branchesByRole[role] as string;
      const worktree = await addWorktreeForExistingBranch(this.taskId, role, branch);
      this.worktrees.set(role, worktree);
      this.agentsInvolved.add(role);
      logEvent({ taskId: this.taskId, event: 'worktree_attached_existing_branch', role, branch, path: worktree.path });

      // The implementer's own historical report (from the original run that
      // produced this branch), read back verbatim as the Integrator's
      // context for that role — not re-synthesized, not re-invoked.
      const existingReport = readArtifact(this.taskId, getProfile(role).artifactFilename);
      this.implementationArtifacts.push({
        role,
        content: existingReport ?? `[No existing ${getProfile(role).artifactFilename} found for this task — branch "${branch}" attached with no prior implementation report.]`,
      });

      const diff = await diffNameStatus(worktree, this.baseCommit);
      this.implementerFilesByRole.set(role, allChangedPaths(diff));
    }

    return this.runIntegratedReviewLoop(plan, implementerRoles, reviewerRoles);
  }

  /**
   * Resumes straight into INTEGRATED_QA_REVIEW against an integration
   * worktree that is already fully built and committed from a prior run —
   * skips CROSS_BRANCH_ANALYSIS and the first INTEGRATION step entirely
   * (unlike resumeFromExistingBranches, which still runs both). Exists for
   * exactly the failure mode a real run hit: the Integrator's own retry
   * budget got consumed entirely by its inability to verify its work with
   * `npm install`/`tsc`/`prisma generate` (a Bash permission gap, since
   * fixed) even though it had, in fact, correctly reconciled everything
   * QA/Security flagged — so the fix that already exists on disk was never
   * given a second review. If review fails again for a real reason, the
   * normal correction loop (RE_INTEGRATION -> review) takes over exactly as
   * it would in a fresh run, with a full new retry budget.
   */
  async resumeReviewOnly(
    plan: SupervisorPlan,
    implementerWorktrees: Map<AgentRole, WorktreeHandle>,
    implementationArtifacts: PrerequisiteArtifact[],
    integrationWorktree: WorktreeHandle,
    integrationResult: IntegrationResult,
    overlapReport: OverlapReport,
    baseCommit: string,
    reviewerRoles: ('qa' | 'security')[]
  ): Promise<{ finalState: TaskState; report: FinalTaskReport }> {
    for (const [role, wt] of implementerWorktrees) {
      this.worktrees.set(role, wt);
      this.agentsInvolved.add(role);
      this.implementerFilesByRole.set(role, allChangedPaths(await diffNameStatus(wt, baseCommit)));
    }
    this.implementationArtifacts = implementationArtifacts;
    this.integrationWorktree = integrationWorktree;
    this.integrationResult = integrationResult;
    this.overlapReport = overlapReport;
    this.baseCommit = baseCommit;
    this.agentsInvolved.add('integrator');

    logEvent({ taskId: this.taskId, event: 'resuming_review_only', integrationBranch: integrationWorktree.branch });

    const implementerRoles = Array.from(implementerWorktrees.keys());
    return this.runIntegrationAndReviewLoop(plan, implementerRoles, overlapReport, reviewerRoles, { alreadyIntegrated: true });
  }

  private finishSuccessfully(plan: SupervisorPlan): { finalState: TaskState; report: FinalTaskReport } {
    this.setState('READY_FOR_FOUNDER');
    if (plan.approvalRequirements.founderApprovalRequired) {
      logEvent({ taskId: this.taskId, event: 'founder_approval_required', reasons: plan.approvalRequirements.reasons, phase: 'post-review' });
      const report = this.buildFinalReport(plan, 'FOUNDER_APPROVAL_REQUIRED');
      return { finalState: 'FOUNDER_APPROVAL_REQUIRED', report };
    }
    this.setState('COMPLETE');
    const report = this.buildFinalReport(plan, 'COMPLETE');
    return { finalState: 'COMPLETE', report };
  }

  async run(plan: SupervisorPlan): Promise<{ finalState: TaskState; report: FinalTaskReport }> {
    const specialistRoles = plan.requiredAgents.filter((r) => GROUP_1_SPECIALISTS.includes(r));
    const implementerRoles = plan.requiredAgents.filter(isImplementerRole);
    const reviewerRoles = plan.requiredAgents.filter((r): r is 'qa' | 'security' => r === 'qa' || r === 'security');

    if (specialistRoles.length > 0) {
      await this.runSpecialistGroup(specialistRoles);
    }

    // ── Dry run: analysis only, never enters IMPLEMENTING. ──────────────────
    if (this.mode === 'dry_run') {
      if (implementerRoles.length > 0) {
        await this.runDryRunEngineeringGroup(implementerRoles);
      }
      const report = this.buildFinalReport(plan, 'DRY_RUN_COMPLETE');
      return { finalState: 'DRY_RUN_COMPLETE', report };
    }

    // ── Full mode ─────────────────────────────────────────────────────────
    this.setState('READY_FOR_IMPLEMENTATION');

    if (implementerRoles.length === 0) {
      // Analysis-only task in full mode (e.g. a pure research/spec task).
      const report = this.buildFinalReport(plan, 'COMPLETE');
      this.setState('COMPLETE');
      return { finalState: 'COMPLETE', report };
    }

    if (plan.approvalRequirements.founderApprovalRequired) {
      logEvent({ taskId: this.taskId, event: 'founder_approval_required', reasons: plan.approvalRequirements.reasons, phase: 'pre-implementation' });
      const report = this.buildFinalReport(plan, 'FOUNDER_APPROVAL_REQUIRED');
      return { finalState: 'FOUNDER_APPROVAL_REQUIRED', report };
    }

    // Every implementer worktree (and, if needed, the integration worktree)
    // branches from this exact same commit — resolved once, up front, so
    // "what changed" is always measured against a shared, stable baseline.
    this.baseCommit = await resolveHead();

    this.setState('IMPLEMENTING');
    await mapConcurrent(implementerRoles, this.maxConcurrency, (role) => this.runImplementer(role));

    if (implementerRoles.length === 1) {
      return this.runSingleImplementerReviewLoop(plan, implementerRoles[0] as AgentRole, reviewerRoles);
    }
    return this.runIntegratedReviewLoop(plan, implementerRoles, reviewerRoles);
  }

  private buildFinalReport(plan: SupervisorPlan, finalState: TaskState, opts?: { extraReason?: string }): FinalTaskReport {
    const reasons = opts?.extraReason ? [...plan.approvalRequirements.reasons, opts.extraReason] : plan.approvalRequirements.reasons;

    const implementerFiles = Array.from(this.implementerFilesByRole.values()).flat();
    const integrationFiles = this.integrationResult?.filesChanged ?? [];
    const filesChanged = Array.from(new Set([...implementerFiles, ...integrationFiles]));

    const nextSteps: string[] = [];
    if (this.mode === 'dry_run') {
      nextSteps.push('Review the specialist/engineering analysis artifacts under this task directory.');
      nextSteps.push('If the plan looks right, re-run with --full to authorize implementation (still subject to the founder approval gate below).');
    }
    if (finalState === 'FOUNDER_APPROVAL_REQUIRED') {
      nextSteps.push('Founder review required before this task can proceed — see approval gate reasons above.');
    }
    if (this.integrationWorktree) {
      nextSteps.push(
        `Review/merge the INTEGRATED branch "${this.integrationWorktree.branch}" at ${this.integrationWorktree.path} — this is the reviewed, mergeable result. The individual implementer branches below are its inputs, already folded in; they don't need separate merging.`
      );
    }
    if (this.worktrees.size > 0) {
      for (const [role, wt] of this.worktrees) {
        nextSteps.push(`Implementer branch "${wt.branch}" (${role}) at ${wt.path} — not auto-merged by the orchestrator.`);
      }
    }

    const report: FinalTaskReport = {
      taskId: this.taskId,
      objective: this.objective,
      finalState,
      agentsInvolved: Array.from(this.agentsInvolved),
      approvalGate: { required: plan.approvalRequirements.founderApprovalRequired || finalState === 'FOUNDER_APPROVAL_REQUIRED', reasons },
      qaVerdict: this.finalQaResult?.verdict,
      securityVerdict: this.finalSecurityResult?.verdict,
      correctionCycles: this.correctionCycles,
      summary: this.summarize(finalState),
      filesChanged,
      nextSteps,
    };

    writeJsonArtifact(this.taskId, 'final-report.summary.json', report);
    writeArtifact(this.taskId, 'final-report.md', renderFinalReportMd(report));
    return report;
  }

  getWorktrees(): Record<string, WorktreeHandle> {
    return Object.fromEntries(this.worktrees);
  }

  getIntegrationWorktree(): WorktreeHandle | undefined {
    return this.integrationWorktree;
  }

  private summarize(finalState: TaskState): string {
    const agentList = Array.from(this.agentsInvolved).join(', ') || '(none)';
    switch (finalState) {
      case 'DRY_RUN_COMPLETE':
        return `Dry run complete. Agents consulted: ${agentList}. No application code was modified.`;
      case 'FOUNDER_APPROVAL_REQUIRED':
        return `Execution stopped for founder approval. Agents involved so far: ${agentList}.`;
      case 'COMPLETE':
        return `Task complete. Agents involved: ${agentList}. ${this.correctionCycles} correction cycle(s) used.`;
      default:
        return `Task ended in state ${finalState}. Agents involved: ${agentList}.`;
    }
  }
}

export async function runTask(options: RunOptions): Promise<RunResult> {
  const taskId = options.taskId ?? generateTaskId(options.objective);
  const maxAgentsPerTask = options.maxAgentsPerTask ?? DEFAULT_MAX_AGENTS_PER_TASK;
  const maxRetryCycles = options.maxRetryCycles ?? DEFAULT_MAX_RETRY_CYCLES;
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  writeArtifact(taskId, 'request.md', renderRequestMd({ taskId, objective: options.objective, mode: options.mode, createdAt: new Date().toISOString() }));
  logEvent({ taskId, event: 'task_started', objective: options.objective, mode: options.mode, maxAgentsPerTask, maxRetryCycles, maxConcurrency });

  logEvent({ taskId, event: 'state_transition', state: 'PLANNING' satisfies TaskState });
  const plan = await buildPlan({ taskId, objective: options.objective, mode: options.mode, maxAgentsPerTask }, options.invoker);
  writeJsonArtifact(taskId, 'plan.json', plan);
  logEvent({ taskId, event: 'plan_created', requiredAgents: plan.requiredAgents, parallelGroups: plan.parallelGroups, founderApprovalRequired: plan.approvalRequirements.founderApprovalRequired });

  const runner = new Runner(taskId, options.objective, options.mode, options.invoker, maxRetryCycles, maxConcurrency);
  const { finalState, report } = await runner.run(plan);

  logEvent({ taskId, event: 'task_finished', finalState, qaVerdict: report.qaVerdict, securityVerdict: report.securityVerdict, correctionCycles: report.correctionCycles });

  return {
    taskId,
    finalState,
    plan,
    finalReport: report,
    worktrees: runner.getWorktrees(),
    integrationWorktree: runner.getIntegrationWorktree(),
  };
}

export interface ResumeIntegrationOptions {
  /** An existing task ID under ai/tasks/ — must already have a plan.json
   * (from a prior PLANNING run) and, ideally, a `<role>-implementation.md`
   * per branch (used as the Integrator's context; not required). */
  taskId: string;
  invoker: ClaudeInvoker;
  /** Existing, already-implemented branches to resume integration on —
   * attached as-is, never recreated or force-pushed to. */
  branches: Partial<Record<AgentRole, string>>;
  maxRetryCycles?: number;
  maxConcurrency?: number;
}

/**
 * Runs the CROSS_BRANCH_ANALYSIS -> INTEGRATION -> INTEGRATED_QA_REVIEW ->
 * INTEGRATED_SECURITY_REVIEW pipeline against branches that already exist
 * from a prior implementation run, instead of running PLANNING and
 * IMPLEMENTING fresh. Exists specifically for a task whose implementer
 * branches predate this integration mechanism (e.g. the saved-listings
 * task that originally exposed the need for it) — reprocessing it through
 * fresh implementer agents would duplicate work and risk producing a THIRD
 * divergent implementation; this reuses the two that already exist.
 *
 * Loads the task's original plan.json as the SupervisorPlan (never invokes
 * the Supervisor again — the original planning decision stands), refreshing
 * only `implementationScopes`, which the schema added after some older
 * plans were written.
 */
export async function resumeIntegration(options: ResumeIntegrationOptions): Promise<RunResult> {
  const { taskId, invoker } = options;
  const maxRetryCycles = options.maxRetryCycles ?? DEFAULT_MAX_RETRY_CYCLES;
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  const rawPlan = readArtifact(taskId, 'plan.json');
  if (!rawPlan) throw new Error(`resumeIntegration: no plan.json found for task "${taskId}" — this only resumes an already-planned task.`);

  const parsedPlan = SupervisorPlanSchema.safeParse(JSON.parse(rawPlan));
  if (!parsedPlan.success) {
    throw new Error(`resumeIntegration: plan.json for task "${taskId}" failed schema validation: ${parsedPlan.error.issues.map((i) => i.message).join('; ')}`);
  }
  let plan = parsedPlan.data;

  const implementerRoles = Object.keys(options.branches) as AgentRole[];
  plan = { ...plan, implementationScopes: defaultScopes(implementerRoles) };
  writeJsonArtifact(taskId, 'plan.json', plan);
  logEvent({ taskId, event: 'plan_reloaded_for_resume', requiredAgents: plan.requiredAgents, implementationScopes: plan.implementationScopes });

  const runner = new Runner(taskId, plan.objective, 'full', invoker, maxRetryCycles, maxConcurrency);
  const { finalState, report } = await runner.resumeFromExistingBranches(plan, options.branches);

  logEvent({ taskId, event: 'task_finished', finalState, qaVerdict: report.qaVerdict, securityVerdict: report.securityVerdict, correctionCycles: report.correctionCycles });

  return {
    taskId,
    finalState,
    plan,
    finalReport: report,
    worktrees: runner.getWorktrees(),
    integrationWorktree: runner.getIntegrationWorktree(),
  };
}

export interface ResumeIntegratedReviewOptions {
  /** An existing task ID that already reached CROSS_BRANCH_ANALYSIS/
   * INTEGRATION in a prior run — must have plan.json, changed-files.json,
   * overlap-report.json, and a built integration worktree still on disk. */
  taskId: string;
  invoker: ClaudeInvoker;
  maxRetryCycles?: number;
  maxConcurrency?: number;
}

/**
 * Resumes a task straight into INTEGRATED_QA_REVIEW against an integration
 * worktree that a prior run already fully built — see Runner.resumeReviewOnly()
 * for the failure mode this exists for. Reconstructs everything from disk:
 * plan.json, changed-files.json (for baseCommit and implementer roles),
 * overlap-report.json, each implementer's and the Integrator's own historical
 * report (read back verbatim as reviewer context), and worktree handles for
 * paths that should already exist (existingWorktreeHandle() throws loudly if
 * any are missing rather than silently proceeding).
 *
 * Trust but verify, same as everywhere else in this file: re-checks the
 * integration worktree for real git conflict markers via unresolvedConflicts()
 * before trusting that it's actually in a reviewable state, regardless of
 * what the prior run's artifacts claimed.
 */
export async function resumeIntegratedReview(options: ResumeIntegratedReviewOptions): Promise<RunResult> {
  const { taskId, invoker } = options;
  const maxRetryCycles = options.maxRetryCycles ?? DEFAULT_MAX_RETRY_CYCLES;
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  const rawPlan = readArtifact(taskId, 'plan.json');
  if (!rawPlan) throw new Error(`resumeIntegratedReview: no plan.json found for task "${taskId}".`);
  const parsedPlan = SupervisorPlanSchema.safeParse(JSON.parse(rawPlan));
  if (!parsedPlan.success) {
    throw new Error(`resumeIntegratedReview: plan.json for task "${taskId}" failed schema validation: ${parsedPlan.error.issues.map((i) => i.message).join('; ')}`);
  }
  const plan = parsedPlan.data;

  const rawChangedFiles = readArtifact(taskId, 'changed-files.json');
  if (!rawChangedFiles) throw new Error(`resumeIntegratedReview: no changed-files.json found for task "${taskId}" — cross-branch analysis never ran.`);
  const changedFiles = JSON.parse(rawChangedFiles) as { baseCommit: string; workers: Array<{ agent: AgentRole }> };
  const baseCommit = changedFiles.baseCommit;
  const implementerRoles = changedFiles.workers.map((w) => w.agent);

  const rawOverlapReport = readArtifact(taskId, 'overlap-report.json');
  if (!rawOverlapReport) throw new Error(`resumeIntegratedReview: no overlap-report.json found for task "${taskId}".`);
  const parsedOverlap = OverlapReportSchema.safeParse(JSON.parse(rawOverlapReport));
  if (!parsedOverlap.success) {
    throw new Error(`resumeIntegratedReview: overlap-report.json for task "${taskId}" failed schema validation: ${parsedOverlap.error.issues.map((i) => i.message).join('; ')}`);
  }
  const overlapReport = parsedOverlap.data;

  const implementerWorktrees = new Map<AgentRole, WorktreeHandle>();
  const implementationArtifacts: PrerequisiteArtifact[] = [];
  for (const role of implementerRoles) {
    implementerWorktrees.set(role, existingWorktreeHandle(taskId, role));
    const report = readArtifact(taskId, getProfile(role).artifactFilename);
    implementationArtifacts.push({ role, content: report ?? `[No existing ${getProfile(role).artifactFilename} found for task "${taskId}".]` });
  }

  const integrationWorktree = existingWorktreeHandle(taskId, 'integration');
  const stillConflicted = await unresolvedConflicts(integrationWorktree);
  if (stillConflicted.length > 0) {
    throw new Error(
      `resumeIntegratedReview: integration worktree at ${integrationWorktree.path} still has real git conflict markers in ${stillConflicted.join(', ')} — this is not actually in a reviewable state. Resolve via resumeIntegration or manually before resuming review.`
    );
  }
  const integrationReportMd = readArtifact(taskId, getProfile('integrator').artifactFilename) ?? '';
  const filesChanged = allChangedPaths(await diffNameStatus(integrationWorktree, baseCommit));
  const integrationResult: IntegrationResult = {
    role: 'integrator',
    taskId,
    branch: integrationWorktree.branch,
    decisions: [],
    filesChanged,
    summary: `Resumed review of an already-built integration worktree from a prior run. See integration-report.md for the Integrator's full original reconciliation record:\n\n${integrationReportMd}`,
    unresolvedConflicts: [],
  };

  const reviewerRoles = plan.requiredAgents.filter((r): r is 'qa' | 'security' => r === 'qa' || r === 'security');

  const runner = new Runner(taskId, plan.objective, 'full', invoker, maxRetryCycles, maxConcurrency);
  const { finalState, report } = await runner.resumeReviewOnly(
    plan,
    implementerWorktrees,
    implementationArtifacts,
    integrationWorktree,
    integrationResult,
    overlapReport,
    baseCommit,
    reviewerRoles
  );

  logEvent({ taskId, event: 'task_finished', finalState, qaVerdict: report.qaVerdict, securityVerdict: report.securityVerdict, correctionCycles: report.correctionCycles });

  return {
    taskId,
    finalState,
    plan,
    finalReport: report,
    worktrees: runner.getWorktrees(),
    integrationWorktree: runner.getIntegrationWorktree(),
  };
}
