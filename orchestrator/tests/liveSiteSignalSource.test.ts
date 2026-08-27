import { describe, it, expect } from 'vitest';
import { ScriptedClaudeInvoker } from '../src/claude/fakeInvoker.js';
import { liveSiteSignalSource } from '../src/autonomy/liveSiteSignalSource.js';

describe('liveSiteSignalSource — bounded, opt-in QA pass against the real published site', () => {
  it('converts AgentAnalysis findings into signals tagged with source "live_site" and environment PRODUCTION', async () => {
    const invoker = new ScriptedClaudeInvoker({
      qa: {
        role: 'qa',
        taskId: 'live-site-scan',
        summary: 'Checked the homepage and one listing detail page.',
        findings: [
          {
            severity: 'medium',
            finding: 'MOBILE_PROBLEM: the filter bar overlaps the map on a 375px viewport.',
            evidence: 'https://muslimrentals.netlify.app/browse',
            recommendedAction: 'Stack the filter bar above the map below 480px.',
          },
        ],
        openQuestions: [],
        recommendation: 'Fix the mobile layout before the next release.',
      },
    });

    const source = liveSiteSignalSource(invoker, 'Improve mobile UX');
    const signals = await source.collect();

    expect(signals).toHaveLength(1);
    expect(signals[0]?.source).toBe('live_site');
    expect(signals[0]?.type).toBe('live_product_finding');
    expect(signals[0]?.metadata).toEqual({ environment: 'PRODUCTION' });
    expect(signals[0]?.evidence).toContain('MOBILE_PROBLEM');
    expect(signals[0]?.location).toBe('https://muslimrentals.netlify.app/browse');
    expect(signals[0]?.severity).toBe(2); // medium
  });

  it('invokes the qa role (which carries the scoped WebFetch grant), not designer/security', async () => {
    const invoker = new ScriptedClaudeInvoker({
      qa: { role: 'qa', taskId: 'live-site-scan', summary: '', findings: [], openQuestions: [], recommendation: '' },
    });

    await liveSiteSignalSource(invoker, 'objective').collect();

    expect(invoker.callsFor('qa')).toHaveLength(1);
    expect(invoker.callsFor('designer')).toHaveLength(0);
    expect(invoker.callsFor('security')).toHaveLength(0);
    const call = invoker.callsFor('qa')[0];
    expect(call?.options.tools).toContain('WebFetch');
  });

  it('returns no signals when the model response fails to parse as AgentAnalysis', async () => {
    const invoker = new ScriptedClaudeInvoker({ qa: { not: 'a valid AgentAnalysis payload' } });
    const signals = await liveSiteSignalSource(invoker, 'objective').collect();
    expect(signals).toEqual([]);
  });
});
