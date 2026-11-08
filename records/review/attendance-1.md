# review: attendance round 1

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | withdrawn | none | Under `## data used by core` of the `core` skill (open-game-works-core/skills/core/SKILL.md:145), the rules for table rows and cell values in a spec's `## data` are data checks. "The server does not start" in a data rule means the binary build fails on the data check ERROR, so `ogw instance start`, `ogw check` and `ogw build run` never start a server with that data. A server module does not check those rules again at server start, and their `## test` items are checked with data tool tests. The rule at attendance.md:159 is in that check: tools/data-tool/src/checks/attendance.ts:10-18 reports `out_of_range` (an ERROR) for every `attendance_reward` row whose `reward` is an empty list and whose `extra_grant` is `false`. The data tool runs that check for each module in `--modules` (tools/data-tool/src/module-check.ts:31-38). tools/data-tool/tests/attendance-checks.test.ts:61-68 checks the row `[a],2,,false` → `ERROR out_of_range`, exit code 1. Lines 70-96 of the same file cover the other data rules (day order, `required_missing`, orphan day). So `complete_start` (server/core/attendance/index.ts:253) correctly checks only the start-time `grant_attendance_extra` rule, and the `## test` item "When there is a row that violates the data rules, the server does not start" is tested in the data tool, not in server/core/attendance/tests/ |

## must fix

none

## unknown

- The commit range 625ae189..625ae189 is empty, so the only review targets were the input `## debt` and `## must fix` items
- tools/data-tool/tests/attendance-checks.test.ts was not run: this worktree has no installed dependencies for tools/data-tool (`npx vitest` fails with `ERR_MODULE_NOT_FOUND`). The D1 judgement comes from reading the check, its wiring and the test
