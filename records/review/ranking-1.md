# review ranking round 1

## findings

none

## previous

none

## out of scope

- server/core/ranking/reward.ts:311: medium At the end of reward retry, `reward_retry` calls `finish_pass` without checking `is_stopped`. The only stop checks are after a retry row is handled (reward.ts:293, reward.ts:308), so when no retry row is due, nothing stops the transition. open-game-works-core/skills/server-core/modules/ranking.md:174 says that after `stop()` has started, the `Closed` and `Retrying` transitions of the end of reward retry are not done. Reproduced on SQLite in a temporary copy: a season is `Retrying` with one retry row whose `next_attempt_at` is in the future, `ranking.seasonCheckIntervalMs` is 1000, `stop()` begins inside the `take_lease` transaction (the same wrap of `storage.db` as server/core/ranking/tests/reward.test.ts:362), and the job runs at `NEXT_DAY` + 5000. The row then has `lease_until_at` 0, written by `finish_pass` after the stop. By reading the code, the same path changes the season to `Closed` when no retry rows are left (e.g. `remove_user` deleted the last one). `close_pass` has this check at reward.ts:275, and its test is reward.test.ts:362; reward retry has no test for this path

## debt

none

## must fix

none

## unknown

- The commit range changes no file of server/core/ranking, its tests, or the ranking-related messages of proto/ogw/core.proto. It also changes no code of `mailbox`, `item-ledger`, `storage`, `server-time`, `logging`, `live-event`, `guild` or `nickname`, and no `ranking.*` setting. The only change aimed at this target is the removal of `dailyResetOffsetMs` from core-spec/ranking.json (commit 0232cb9). That matches `## settings` of the ranking spec, which does not list the key. The key stays in core-spec/server-time.json, server/core/ranking does not read it directly, and the test at server/core/ranking/tests/season.test.ts:29 that sets it passes
- The other change of the range that reaches ranking is `coreDataOf` in tools/data-tool/src/corespec.ts, which adds the enums of the `requirement` header to core data. Only its diff was read. tools/data-tool/tests/ranking-check.test.ts was read only for its presence and was not run for this review
- `ogw core test server ranking` passed on the checked commit, and it may have used a kept result of the same key. All 67 tests of server/core/ranking/tests also passed when run directly on SQLite in a temporary copy, with none skipped, so the guild and nickname tests ran. That direct run was not repeated on PostgreSQL
- The defect in `## out of scope` was reproduced on SQLite only. It was not reproduced on PostgreSQL. The `Closed` variant was judged from the code and was not run
- The source files of server/core/ranking were read in full for `## out of scope`, but the items of `## test` of the spec were compared with test titles and only partly with test bodies. No test was checked by restoring a defect, because the range changes no ranking code
- Query cost (`count_ahead`, `read_page` with `OFFSET`) was not measured with a large season on PostgreSQL, so no `efficiency` judgement was made
- The code of `mailbox`, `storage`, `guild`, `nickname`, `auth` and `admin-api` was read only where ranking calls it or calls ranking; those modules are other review targets
