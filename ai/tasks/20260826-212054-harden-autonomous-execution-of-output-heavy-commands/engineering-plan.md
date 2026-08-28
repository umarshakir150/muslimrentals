# Engineering implementation result

**Task:** 20260826-212054-harden-autonomous-execution-of-output-heavy-commands
**Branch:** agents/20260826-212054-harden-autonomous-execution-of-output-heavy-commands/engineering
**No changes needed:** no

## Summary

Traced the 'stdout maxBuffer length exceeded' failure to the shared Bash-permission model: every implementer/reviewer role (engineering, frontend, backend, qa, security, integrator) is already allowed to run npm install/build/typecheck/prisma commands with any flags or output redirection appended (registry.ts's `Bash(npm install*)` etc. patterns are prefix wildcards), so no permission change was needed — the gap was that no role was ever told to use quiet flags or redirect-to-file for output-heavy commands. Added a ground rule to CLAUDE.md (which every role receives verbatim in its system prompt via contextBuilder.ts's renderSystemPrompt) instructing agents to run install/build/typecheck commands with low-verbosity flags (e.g. `npm install --no-fund --no-audit --loglevel=error`) and, for commands whose output could still be large, redirect stdout+stderr to a log file and inspect only the tail/errors rather than letting full raw output flow back through the tool call.

## Files changed

- CLAUDE.md

## Test plan

No automated test suite covers CLAUDE.md content (it's prose read at runtime by contextBuilder.ts, not parsed/validated). Manually verified: (1) grep confirms the new bullet is present under 'Ground rules for every agent'; (2) confirmed via orchestrator/src/context/contextBuilder.ts that CLAUDE.md is injected as `sharedContext` into every role's system prompt (renderSystemPrompt), so the new guidance reaches engineering/frontend/backend/qa/security/integrator without per-role edits; (3) confirmed via orchestrator/src/agents/registry.ts that the existing `Bash(npm install*)`, `Bash(npm run build*)`, `Bash(npx tsc*)`, `Bash(npx prisma generate*)` etc. allow-patterns are prefix wildcards, so agents following the new guidance (adding flags, `>` redirection, `&&` tail/grep) remain within their existing permission grants — no registry.ts change required. Did not run a live npm install/build reproduction since the failure is in the CLI's own Bash tool output capture, not in orchestrator code; this is a prompt/instruction-level mitigation, verifiable in practice on the next task that runs an output-heavy command.

## Self-check notes

- This is a prose/instruction-level mitigation (agent guidance), not a code-level enforcement mechanism — there is no way to programmatically force the claude CLI's internal Bash tool to redirect output; compliance depends on agents following the CLAUDE.md guidance.
- Considered also editing orchestrator/src/agents/registry.ts's allow-pattern lists but confirmed they already permit any suffix (flags/redirection/chaining) on the relevant npm/npx commands, so no change was needed there.
- Considered adding role-specific guidance to agents/qa.md, agents/engineering.md, etc. instead, but CLAUDE.md is shared by every role via contextBuilder.ts and is the single point that reaches all affected roles (engineering, frontend, backend, qa, security, integrator) without duplication.
- No QA/Security review has been run on this change yet; flagging per the required workflow since this task ships without a separate review pass in this session.
