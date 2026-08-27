# Engineering implementation result

**Task:** 20260827-084339-diagnose-repeated-integrator-role-execution-failures-spawn
**Branch:** agents/20260827-084339-diagnose-repeated-integrator-role-execution-failures-spawn/engineering
**No changes needed:** no

## Summary

Root-caused and fixed the recurring Integrator-role `spawn E2BIG` / silent exit-code-1 failures: `CliClaudeInvoker.buildClaudeArgs()` was putting the entire `userPrompt` — which, uniquely for the Integrator, aggregates every implementer's full report plus the deterministic overlap/scope analysis with no length bound anywhere in the codebase — into a single positional CLI argument, hitting the OS argv/environ size limit on large multi-implementer tasks. The earlier `.gitignore` fix (bl_d53d390c-era) addressed one specific trigger (tracked `node_modules` bloating the overlap report) but not the underlying design flaw, which is why it recurred. Fixed by never putting the prompt in argv at all: `runProcess()` now pipes `userPrompt` over the child's stdin (`stdio: ['pipe','pipe','pipe']`, write+end, with an `error` listener on `child.stdin` so a broken pipe can't crash the orchestrator), while argv carries only a small fixed pointer constant (`STDIN_PROMPT_POINTER`) telling the model to read its task from stdin — combining a positional prompt with piped stdin content is a standard `claude -p` usage pattern already implicit in this file's own historical "3s stdin wait" comment. Also hardened error visibility for the "silent exit code 1" failure mode: the nonzero-exit path now reports the exit signal (previously discarded), stdout bytes received, and total argv byte size in the thrown error, so a future failure isn't a dead end. Updated `tests/claudeAdapter.test.ts` (replaced the now-invalid "prompt is the last argv element" assertion with regression tests proving a multi-MB prompt never touches argv) and `tests/fixtures/hangWithChild.mjs` (switched from reading its pidfile path off argv to reading it off stdin, matching the new transport). Documented the incident and fix in `orchestrator/README.md`'s Troubleshooting section per the file's existing convention.

## Files changed

- orchestrator/README.md
- orchestrator/src/claude/claudeAdapter.ts
- orchestrator/tests/claudeAdapter.test.ts
- orchestrator/tests/fixtures/hangWithChild.mjs

## Test plan

Ran the orchestrator's full automated suite (this is the one part of the codebase with test tooling, unlike rentals/frontend|backend): `npm run typecheck` (clean) and `npm run test` (vitest) — all 13 test files / 157 tests pass, including `tests/claudeAdapter.test.ts` (16/16, covering the new stdin-transport regression tests) and `tests/processLifecycle.test.ts` (14/14, including the real-subprocess grandchild-kill test that now exercises stdin-delivered content end-to-end rather than argv). Also manually inspected `git diff --stat` to confirm only the 4 intended files changed with no stray artifacts from test runs.

## Self-check notes

- This fix touches the orchestration engine itself (orchestrator/src), not the product app (rentals/), so QA's usual manual-browser-testing workflow and Trust & Safety/Legal review don't apply — the orchestrator's own automated test suite (157 passing tests, including 2 new regression tests specifically proving a multi-MB prompt never reaches argv) is the correct and sufficient verification gate here, per this repo's own testing conventions for orchestrator/ vs rentals/.
- I could not empirically invoke the real `claude` CLI to verify stdin+positional-prompt combining behavior (the sandbox explicitly denies Bash commands referencing the `claude` binary — a deliberate anti-recursive-spawning guard I did not attempt to work around). The fix is designed conservatively to minimize risk from this: it keeps a real (fixed, tiny) positional prompt rather than betting on an unverified 'stdin fully replaces the prompt with none given' CLI mode, resting instead on the documented/standard 'positional prompt + piped stdin content' combination — which this file's own pre-existing code comment (the historical '~3s stdin wait' workaround) already implies the installed CLI performs. Recommend the next real --full run against a large task be watched to empirically confirm the model actually receives the stdin content as expected, exactly as the README's Troubleshooting entry for the `dontAsk` permission-mode assumption already recommends doing for other CLI-behavior assumptions.
- Did not touch the earlier `.gitignore` fix (still correctly in place, verified 0 tracked node_modules paths) — that fix remains valid for its original trigger; this task fixes the separate, deeper design flaw that let the failure recur without node_modules being involved at all.
- No CHANGES_REQUIRED review loop applies here since this is infra/tooling work in the orchestrator itself, not a product feature — flagging per Engineering Lead's hard limits that QA/Security/Trust & Safety sign-off is a product-feature-review gate this task doesn't fall under, not something skipped.
