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
 */
import type { AgentRole, AgentAnalysis, FinalTaskReport, ImplementationResult, ReviewResult, SupervisorPlan, TaskState } from '../types/schemas.js';
import { AgentAnalysis as AgentAnalysisSchema, ImplementationResult as ImplementationResultSchema, ReviewResult as ReviewResultSchema, JsonSchemas } from '../types/schemas.js';
import type { ClaudeInvoker } from '../claude/claudeAdapter.js';
import { getProfile, isImplementerRole } from '../agents/registry.js';
import { buildContext, renderSystemPrompt, renderUserPrompt, type PrerequisiteArtifact } from '../context/contextBuilder.js';
import { buildPlan, DEFAULT_MAX_AGENTS_PER_TASK, GROUP_1_SPECIALISTS } from './planner.js';
import { mapConcurrent } from './concurrency.js';
import { createWorktree, changedFiles, type WorktreeHandle } from '../git/worktree.js';
import { generateTaskId } from '../task/taskId.js';
import { writeArtifact, writeJsonArtifact } from '../task/taskStore.js';
import { renderRequestMd, renderAgentAnalysisMd, renderImplementationMd, renderFinalReportMd } from '../task/render.js';
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
}

const ANALYSIS_INSTRUCTION =
  'Respond with ONLY the JSON object matching the required AgentAnalysis schema — no prose, no markdown fences outside the JSON. "recommendation" must be a clear, actionable recommendation for the Supervisor and Engineering Lead.';

const DRY_RUN_ENGINEERING_INSTRUCTION =
  'This is a DRY RUN. Do NOT write or edit any files — you do not have Write/Edit tools in this session. Produce a consolidated technical analysis only: what would need to change, roughly which areas/files, migration/regression risk, and a Frontend/Backend split if relevant. Respond with ONLY the JSON object matching the required AgentAnalysis schema — no prose, no markdown fences.';

const IMPLEMENTATION_INSTRUCTION =
  'You are working inside an isolated git worktree/branch that already exists and is checked out — only make changes here, never `git checkout` elsewhere. When you are done (or have determined no code change is needed), respond with ONLY the JSON object matching the required ImplementationResult schema — no prose, no markdown fences. Set "branch" to the current git branch (`git branch --show-current` if unsure).';

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

class Runner {
  private worktrees = new Map<AgentRole, WorktreeHandle>();
  private specialistArtifacts: PrerequisiteArtifact[] = [];
  private implementationArtifacts: PrerequisiteArtifact[] = [];
  private agentsInvolved = new Set<AgentRole>();
  private correctionCycles = 0;
  private qaResult: ReviewResult | undefined;
  private securityResult: ReviewResult | undefined;

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
      worktree = await createWorktree(this.taskId, role);
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

    // Ground truth for "what changed" is git, not the model's self-report.
    try {
      const actualFiles = await changedFiles(worktree);
      result = { ...result, filesChanged: actualFiles };
    } catch (err) {
      logEvent({ taskId: this.taskId, event: 'changed_files_check_failed', role, error: String(err) });
    }

    writeArtifact(this.taskId, profile.artifactFilename, renderImplementationMd(result));
    logEvent({ taskId: this.taskId, event: 'agent_complete', role, artifact: profile.artifactFilename, filesChanged: result.filesChanged.length });

    this.implementationArtifacts.push({ role, content: JSON.stringify(result) });
    return result;
  }

  private async runReviewer(role: 'qa' | 'security', worktreePath: string): Promise<ReviewResult> {
    const profile = getProfile(role);
    const bundle = buildContext({
      role,
      objective: this.objective,
      prerequisiteArtifacts: [...this.specialistArtifacts, ...this.implementationArtifacts],
    });
    const systemPromptAddition = renderSystemPrompt(bundle);
    const userPrompt = renderUserPrompt(bundle, reviewInstruction(role));

    logEvent({ taskId: this.taskId, event: 'agent_launch', role });
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
      logEvent({ taskId: this.taskId, event: 'agent_output_validation_failed', role, issues: parsed.error.issues.map((i) => i.message) });
    }

    writeJsonArtifact(this.taskId, profile.artifactFilename, result);
    logEvent({ taskId: this.taskId, event: 'review_verdict', role, verdict: result.verdict });
    return result;
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

    this.setState('IMPLEMENTING');
    await mapConcurrent(implementerRoles, this.maxConcurrency, (role) => this.runImplementer(role));

    // Reviewers run against the primary (first) implementer's worktree.
    // Known limitation when >1 implementer role ran — see README.
    const primaryRole = implementerRoles[0] as AgentRole;
    const primaryWorktree = this.worktrees.get(primaryRole);
    if (!primaryWorktree) throw new Error('Internal error: implementer ran without a worktree.');

    let approved = false;
    while (!approved) {
      this.setState(this.correctionCycles === 0 ? 'QA_REVIEW' : 'RE_REVIEW');
      const [qa, security] = await Promise.all(
        (['qa', 'security'] as const)
          .filter((r) => reviewerRoles.includes(r))
          .map((r) => this.runReviewer(r, primaryWorktree.path))
      );
      // If a reviewer role wasn't requested by the plan, treat it as N/A-passing.
      this.qaResult = reviewerRoles.includes('qa') ? qa ?? this.qaResult : this.qaResult;
      this.securityResult = reviewerRoles.includes('security') ? security ?? this.securityResult : this.securityResult;

      const qaFailed = this.qaResult && this.qaResult.verdict === 'CHANGES_REQUIRED';
      const securityFailed = this.securityResult && this.securityResult.verdict === 'CHANGES_REQUIRED';

      if (!qaFailed && !securityFailed) {
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
      logEvent({ taskId: this.taskId, event: 'correction_cycle_started', cycle: this.correctionCycles, qaVerdict: this.qaResult?.verdict, securityVerdict: this.securityResult?.verdict });
      const feedback = renderCorrectionFeedback(this.qaResult, this.securityResult);
      this.setState('IMPLEMENTING');
      await this.runImplementer(primaryRole, feedback);
    }

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

  private buildFinalReport(plan: SupervisorPlan, finalState: TaskState, opts?: { extraReason?: string }): FinalTaskReport {
    const reasons = opts?.extraReason ? [...plan.approvalRequirements.reasons, opts.extraReason] : plan.approvalRequirements.reasons;
    const filesChanged = Array.from(new Set(this.implementationArtifacts.flatMap((a) => (JSON.parse(a.content) as ImplementationResult).filesChanged)));

    const nextSteps: string[] = [];
    if (this.mode === 'dry_run') {
      nextSteps.push('Review the specialist/engineering analysis artifacts under this task directory.');
      nextSteps.push('If the plan looks right, re-run with --full to authorize implementation (still subject to the founder approval gate below).');
    }
    if (finalState === 'FOUNDER_APPROVAL_REQUIRED') {
      nextSteps.push('Founder review required before this task can proceed — see approval gate reasons above.');
    }
    if (this.worktrees.size > 0) {
      for (const [role, wt] of this.worktrees) {
        nextSteps.push(`Review/merge branch "${wt.branch}" (${role}) at ${wt.path} — not auto-merged by the orchestrator.`);
      }
    }

    const report: FinalTaskReport = {
      taskId: this.taskId,
      objective: this.objective,
      finalState,
      agentsInvolved: Array.from(this.agentsInvolved),
      approvalGate: { required: plan.approvalRequirements.founderApprovalRequired || finalState === 'FOUNDER_APPROVAL_REQUIRED', reasons },
      qaVerdict: this.qaResult?.verdict,
      securityVerdict: this.securityResult?.verdict,
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

  return { taskId, finalState, plan, finalReport: report, worktrees: runner.getWorktrees() };
}
