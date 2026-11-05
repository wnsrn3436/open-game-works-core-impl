# review block-report round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | `spec` | medium | server/core/block-report/index.ts:301 | The range added `ref.includes('\u0000')` (index.ts:301) and `evidence.includes('\u0000')` (index.ts:304) to the `INVALID_INPUT` conditions of `add_report`. The defining documents give `ref` only the rule "At most `block-report.maxRefBytes` bytes" (block-report.md:77) and `evidence` only "At most `block-report.maxEvidenceBytes` bytes" (block-report.md:79), and `INVALID_INPUT` is "`ref`, `comment` or `evidence` breaks its rule" (block-report.md:90). So `add_report` from a content handler with `ref` `a\u0000b` or `evidence` `te\u0000xt` within the byte limits is `OK` by the spec, while the code returns `INVALID_INPUT` and writes the `error` log (test server/core/block-report/tests/report.test.ts:231 asserts that result). The rule is needed (PostgreSQL rejects U+0000 in a text value, `storage` `## behavior` storage.md:305 requires the same result in both DBs), but it is not in the definition; the core agent report already proposes the spec text | Add "holds no U+0000" to the `ref` and `evidence` lines of `block-report` `## API` and a `## test` item for it (or a general rule in `storage` or `validation` for request strings written to text columns) | yes | 85 |
| R2-2 | `efficiency` | medium | server/core/block-report/index.ts:420 | Input `## debt` D3, still present. `BlockUser` of a not-yet-blocked target loops over every block row of the caller (index.ts:419) and calls `profiles.is_active_user` for each; each call is one `storage.get_user_record` query (server/core/public-profile/index.ts:180). Queries per `BlockUser` grow with the caller's block row count, up to `block-report.maxBlocks` (default 100, no schema maximum). The code follows `BlockUser` step 4 (block-report.md:101), which judges each `blocked_id` with `is_active_user`; the only batch read of user records, `storage.get_user_records`, has `caller` `public-profile` only (storage.md:61), and `public-profile` has no batch active-user operation, so the fix needs a definition change (core agent report `## review` R1-2) | Give `block-report` a batch read of the withdrawal state (add `block-report` to the `caller` of `storage.get_user_records`, or add a list form of `is_active_user` to `public-profile` built on it), and change `BlockUser` step 4 to use it once per group | yes | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | index.ts:301 rejects a `ref` holding U+0000 before the report row write. Tests report.test.ts:128 and :231. With the check removed in a temporary copy, both tests failed on SQLite (`ReportUser` success, `add_report` `OK`) and on PostgreSQL (`ReportUser` code 8, `add_report` run `INTERNAL`). The rule itself is not in the spec: R2-1 |
| R1-2 | withdrawn | The `disputed` evidence of the core agent report is right: the code follows `BlockUser` step 4 (block-report.md:101), and block-report cannot read user records in one query (`storage.get_user_records` caller is `public-profile` only, storage.md:61; no batch operation in `public-profile`), so the fix with `spec change` `no` cannot be made. The defect remains and is written again as R2-2 with `spec change` `yes` |
| R1-3 | fixed | Restored: `is_plain_text(comment, settings.max_comment_length)` → `is_plain_text(comment, 1000000)` at index.ts:302 in a temporary copy. Failed on both DBs: report.test.ts:139 (`ReportUser` over-length comment accepted) and :244 (`add_report` got `['OK', 'OK']`) |
| R1-4 | fixed | Restored: `log_invalid` `true` in `ReportUser` (index.ts:459) in a temporary copy. Failed on both DBs: report.test.ts:112 (error log lines present where `[]` is expected) and :128 |
| R1-5 | fixed | Restored: `window_end = window_start + 5n * settings.report_window_ms` in a temporary copy. Failed on both DBs: report.test.ts:150 and :162 (`block_report_count` row `expires_at` differs) |
| R1-6 | fixed | Restored in temporary copies, one at a time: window start from `time.clock_now()` → report.test.ts:162 failed on both DBs (`REPORT_LIMIT` 68 where success is expected); report `created_at` from `clock_now` → report.test.ts:162 failed on both DBs (`created_at` `1800000000000` for ref `2`); block row `created_at` from `time.clock_now()` → block.test.ts:200 failed on both DBs (`blocked_at` 1800000000000 where 1800000005000 is expected) |
| R1-7 | fixed | Restored: the `core_log` call of a second `register_block_listener` deleted in a temporary copy. start.test.ts:9 failed on both DBs (`expected [] to have a length of 1`) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | index.ts:301 rejects `ref` with U+0000; tests report.test.ts:128 and :231 fail on both DBs when the check is removed |
| D3 | open | R2-2 | index.ts:419-420 still calls `is_active_user` (one `get_user_record` query) per block row |
| D4 | fixed | none | report.test.ts:139 and :244 fail on both DBs with the limit replaced by 1000000 |
| D5 | fixed | none | report.test.ts:112 and :128 fail on both DBs with `log_invalid` `true` in `ReportUser` |
| D6 | fixed | none | report.test.ts:150 fails on both DBs with `expires_at` = window start + 5 × window |
| D7 | fixed | none | report.test.ts:162 and block.test.ts:200 fail on both DBs for each of the three `clock_now` mutations |
| D8 | fixed | none | start.test.ts:9 fails on both DBs with the log call deleted |

## must fix

none

## unknown

- Mutation runs used `ogw core test server block-report --file <test file>` in a temporary git worktree of HEAD 6909524 (removed afterwards), one mutation per run, on SQLite and PostgreSQL. Only report.test.ts, block.test.ts and start.test.ts were run; the whole block-report suite and the dependent modules were not run in this round.
- The other changes in the commit range (auth, gacha, ScreenEffectCore, `auth.socialVerifyTimeoutMs` schema minimum) are outside this target and were not reviewed.
- Whether `chat` can pass an `evidence` holding U+0000 to `add_report` (which would now be `INVALID_INPUT`) was not checked in `chat`.
