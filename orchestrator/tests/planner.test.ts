/**
 * Unit tests for buildPlan()'s deterministic post-processing — specifically
 * the "engineering" vs. "frontend"/"backend" mutual-exclusivity fix
 * (src/supervisor/planner.ts). Found on a real run: the Supervisor named
 * both "engineering" (scoped to the whole app) and a "frontend"/"backend"
 * split in the same plan, which would have run three implementers
 * redundantly building the same feature concurrently instead of two
 * complementary ones — resolved in code, not left to prompt wording.
 */
import { describe, it, expect } from 'vitest';
import { buildPlan } from '../src/supervisor/planner.js';
import { ScriptedClaudeInvoker } from '../src/claude/fakeInvoker.js';
import { scriptedPlan } from './testUtils.js';

describe('buildPlan — engineering vs. frontend/backend mutual exclusivity', () => {
  it('drops "engineering" when both "frontend" and "backend" are also present', async () => {
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['engineering', 'frontend', 'backend', 'qa', 'security']),
    });
    const plan = await buildPlan({ taskId: 't-drop-both', objective: 'Build a new feature', mode: 'full' }, invoker);

    expect(plan.requiredAgents).not.toContain('engineering');
    expect(plan.requiredAgents).toContain('frontend');
    expect(plan.requiredAgents).toContain('backend');
  });

  it('drops "engineering" when only "frontend" (not "backend") is also present', async () => {
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['engineering', 'frontend', 'qa', 'security']),
    });
    const plan = await buildPlan({ taskId: 't-drop-frontend-only', objective: 'Build a new feature', mode: 'full' }, invoker);

    expect(plan.requiredAgents).not.toContain('engineering');
    expect(plan.requiredAgents).toContain('frontend');
  });

  it('keeps "engineering" when it is the only implementer role (no frontend/backend split)', async () => {
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['engineering', 'qa', 'security']),
    });
    const plan = await buildPlan({ taskId: 't-keep-engineering', objective: 'Fix a small bug', mode: 'full' }, invoker);

    expect(plan.requiredAgents).toContain('engineering');
  });

  it('keeps "frontend"/"backend" untouched when "engineering" was never proposed', async () => {
    const invoker = new ScriptedClaudeInvoker({
      supervisor: scriptedPlan(['frontend', 'backend', 'qa', 'security']),
    });
    const plan = await buildPlan({ taskId: 't-keep-split', objective: 'Build a feature that splits cleanly', mode: 'full' }, invoker);

    expect(plan.requiredAgents).toContain('frontend');
    expect(plan.requiredAgents).toContain('backend');
    expect(plan.requiredAgents).not.toContain('engineering');
  });
});
