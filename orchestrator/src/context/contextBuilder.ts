/**
 * Per-role context assembly.
 *
 * Deliberately the opposite of "hand the whole repo to every agent": each
 * role gets (1) its own persistent instructions from agents/<role>.md,
 * (2) CLAUDE.md as the shared minimum every role needs (founder authority,
 * required workflow — it's ~190 lines, not the repo), (3) a small, curated
 * set of company/ and ai/ docs that are actually relevant to that role's
 * job (see RELEVANCE_MAP below), (4) the current task's objective, and
 * (5) only the specific prerequisite agents' outputs this role depends on
 * — never every other agent's output, and never the raw application
 * source tree unless the role's own tools (Read/Grep/Glob) go fetch it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentRole } from '../types/schemas.js';
import { getProfile } from '../agents/registry.js';
import { CLAUDE_MD, REPO_ROOT } from '../paths.js';

// Curated relevance map: role -> extra docs (relative to repo root) beyond
// its own agents/<role>.md and CLAUDE.md. Keep this short and deliberate —
// adding a doc here is a decision, not a default.
const RELEVANCE_MAP: Record<AgentRole, string[]> = {
  supervisor: [
    'company/product.md',
    'company/architecture.md',
    'ai/current-state.md',
    'ai/workflow.md',
  ],
  engineering: ['company/architecture.md', 'ai/current-state.md', 'company/principles.md'],
  frontend: ['company/architecture.md', 'ai/current-state.md', 'company/principles.md'],
  backend: ['company/architecture.md', 'ai/current-state.md', 'company/principles.md'],
  qa: ['company/architecture.md', 'ai/current-state.md'],
  security: ['company/architecture.md', 'ai/current-state.md', 'company/principles.md'],
  integrator: ['company/architecture.md', 'ai/current-state.md', 'company/principles.md'],
  designer: ['company/product.md', 'company/users.md', 'company/principles.md'],
  trust_safety: ['company/product.md', 'company/users.md', 'company/principles.md'],
  legal: ['company/product.md', 'company/users.md', 'company/architecture.md'],
  support: ['company/product.md', 'company/users.md'],
};

function safeRead(relPath: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  } catch {
    return `[missing: ${relPath}]`;
  }
}

export interface PrerequisiteArtifact {
  role: AgentRole;
  content: string;
}

export interface ContextBundle {
  role: AgentRole;
  roleInstructions: string;
  sharedContext: string;
  companyContext: Array<{ path: string; content: string }>;
  objective: string;
  prerequisiteArtifacts: PrerequisiteArtifact[];
  correctionFeedback?: string;
}

export function buildContext(params: {
  role: AgentRole;
  objective: string;
  prerequisiteArtifacts?: PrerequisiteArtifact[];
  correctionFeedback?: string;
}): ContextBundle {
  const profile = getProfile(params.role);
  return {
    role: params.role,
    roleInstructions: safeRead(profile.roleFile),
    sharedContext: readFileSync(CLAUDE_MD, 'utf8'),
    companyContext: (RELEVANCE_MAP[params.role] ?? []).map((p) => ({
      path: p,
      content: safeRead(p),
    })),
    objective: params.objective,
    prerequisiteArtifacts: params.prerequisiteArtifacts ?? [],
    correctionFeedback: params.correctionFeedback,
  };
}

/** Reference material (role instructions + shared/company docs) — goes in the system prompt. */
export function renderSystemPrompt(bundle: ContextBundle): string {
  const sections = [
    `# Your role: ${bundle.role}\n\n${bundle.roleInstructions}`,
    `# Shared project context (CLAUDE.md)\n\n${bundle.sharedContext}`,
    ...bundle.companyContext.map((c) => `# Reference: ${c.path}\n\n${c.content}`),
  ];
  return sections.join('\n\n---\n\n');
}

/** Task-specific material (objective + prerequisite outputs + correction feedback) — the user turn. */
export function renderUserPrompt(bundle: ContextBundle, instructionSuffix: string): string {
  const parts = [`## Task objective\n\n${bundle.objective}`];

  if (bundle.prerequisiteArtifacts.length > 0) {
    parts.push(
      '## Prerequisite agent outputs (for your context only — do not restate them, build on them)',
      ...bundle.prerequisiteArtifacts.map((p) => `### Output from: ${p.role}\n\n${p.content}`)
    );
  }

  if (bundle.correctionFeedback) {
    parts.push(
      '## Correction required — a reviewer returned CHANGES_REQUIRED on your previous output',
      bundle.correctionFeedback,
      'Address every finding above before responding again.'
    );
  }

  parts.push(instructionSuffix);
  return parts.join('\n\n');
}

// Re-exported for callers that only need the doc paths this role gets,
// e.g. logging/tests, without reading file contents.
export function relevantDocsFor(role: AgentRole): string[] {
  return RELEVANCE_MAP[role] ?? [];
}
