import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, extractStructuredPayload, type ClaudeInvokeOptions } from '../src/claude/claudeAdapter.js';

function baseOptions(overrides: Partial<ClaudeInvokeOptions> = {}): ClaudeInvokeOptions {
  return {
    role: 'designer',
    systemPromptAddition: 'You are the Product Designer.',
    userPrompt: 'Design a flow.',
    cwd: '/tmp',
    jsonSchema: { type: 'object', properties: {} },
    tools: ['Read', 'Grep', 'Glob'],
    allowedToolPatterns: [],
    disallowedToolPatterns: [],
    maxBudgetUsd: 0.5,
    ...overrides,
  };
}

describe('buildClaudeArgs', () => {
  it('always runs headless print mode with json output', () => {
    const args = buildClaudeArgs(baseOptions());
    expect(args[0]).toBe('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
  });

  it('passes the tool allowlist as a hard boundary', () => {
    const args = buildClaudeArgs(baseOptions({ tools: ['Read', 'Grep'] }));
    const idx = args.indexOf('--tools');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('Read');
    expect(args[idx + 2]).toBe('Grep');
    // Nothing implementation-shaped ever appears for a read-only profile.
    expect(args).not.toContain('Write');
    expect(args).not.toContain('Edit');
  });

  it('never grants tools by omission — an empty tool list is passed explicitly', () => {
    const args = buildClaudeArgs(baseOptions({ tools: [] }));
    const idx = args.indexOf('--tools');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('');
  });

  it('includes fine-grained allow/deny Bash patterns when present', () => {
    const args = buildClaudeArgs(
      baseOptions({
        tools: ['Read', 'Bash'],
        allowedToolPatterns: ['Bash(npm test*)'],
        disallowedToolPatterns: ['Bash(git push*)'],
      })
    );
    expect(args).toContain('--allowedTools');
    expect(args).toContain('Bash(npm test*)');
    expect(args).toContain('--disallowedTools');
    expect(args).toContain('Bash(git push*)');
  });

  it('uses a non-interactive permission mode suitable for headless batch execution', () => {
    const args = buildClaudeArgs(baseOptions());
    const idx = args.indexOf('--permission-mode');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('dontAsk');
  });

  it('isolates worker sessions from the outer session (no MCP, no project hooks, no persistence)', () => {
    const args = buildClaudeArgs(baseOptions());
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    const idx = args.indexOf('--setting-sources');
    expect(args[idx + 1]).toBe('user');
  });

  it('enforces a spend cap per invocation', () => {
    const args = buildClaudeArgs(baseOptions({ maxBudgetUsd: 2.5 }));
    const idx = args.indexOf('--max-budget-usd');
    expect(args[idx + 1]).toBe('2.5');
  });

  it('passes the JSON schema for structured output', () => {
    const schema = { type: 'object', properties: { foo: { type: 'string' } }, required: ['foo'] };
    const args = buildClaudeArgs(baseOptions({ jsonSchema: schema }));
    const idx = args.indexOf('--json-schema');
    expect(JSON.parse(args[idx + 1] as string)).toEqual(schema);
  });

  it('puts the user prompt last as the positional argument', () => {
    const args = buildClaudeArgs(baseOptions({ userPrompt: 'DO THE THING' }));
    expect(args[args.length - 1]).toBe('DO THE THING');
  });

  it('only sets --model when explicitly requested', () => {
    expect(buildClaudeArgs(baseOptions())).not.toContain('--model');
    const withModel = buildClaudeArgs(baseOptions({ model: 'claude-sonnet-5' }));
    expect(withModel).toContain('--model');
    expect(withModel[withModel.indexOf('--model') + 1]).toBe('claude-sonnet-5');
  });
});

describe('extractStructuredPayload', () => {
  it('prefers the dedicated structured_output field when present (verified against the real CLI envelope)', () => {
    const stdout = JSON.stringify({
      result: '{"hello":"Hello!"}',
      structured_output: { hello: 'Hello!' },
      total_cost_usd: 0.0347,
    });
    const { json, costUsd } = extractStructuredPayload(stdout);
    expect(json).toEqual({ hello: 'Hello!' });
    expect(costUsd).toBe(0.0347);
  });

  it('parses a `result` field that is a JSON string', () => {
    const stdout = JSON.stringify({ result: JSON.stringify({ hello: 'world' }), total_cost_usd: 0.01 });
    const { json, costUsd } = extractStructuredPayload(stdout);
    expect(json).toEqual({ hello: 'world' });
    expect(costUsd).toBe(0.01);
  });

  it('accepts a `result` field that is already an object', () => {
    const stdout = JSON.stringify({ result: { hello: 'world' } });
    const { json } = extractStructuredPayload(stdout);
    expect(json).toEqual({ hello: 'world' });
  });

  it('accepts an envelope with no `result` wrapper at all', () => {
    const stdout = JSON.stringify({ hello: 'world' });
    const { json } = extractStructuredPayload(stdout);
    expect(json).toEqual({ hello: 'world' });
  });

  it('throws a clear error on unparseable stdout', () => {
    expect(() => extractStructuredPayload('not json at all')).toThrow();
  });
});
