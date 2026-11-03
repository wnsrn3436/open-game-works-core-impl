# review chat round 1

## findings

none

## previous

none

## out of scope

- server/core/chat/index.ts:304: medium `chat` `### send` step 6 makes a `Direct` send `CHAT_NOT_FRIEND` when `are_friends` is `false` after the channel lock, and no test reaches it. The only `CHAT_NOT_FRIEND` assert is server/core/chat/tests/direct.test.ts:41, which step 1 answers for a stranger. server/core/chat/tests/withdraw.test.ts:149 removes the friend link only together with a withdrawal, which ends with `USER_NOT_FOUND`. Run path with no test: friends A and B, A sends to B while another transaction holds the channel key, removes the friend link and commits. Removing the check at this line fails no chat test
- server/core/chat/index.ts:354: medium `chat` `### receive` selects `chat.maxFetchCount` `chat_deletion` rows in ascending order of `delete_seq` and sets `last_delete_seq` to the largest selected, and no test has more deletions than that count. Every `deleted_seqs` assert (server/core/chat/tests/guild.test.ts:93-108, server/core/chat/tests/withdraw.test.ts:87) runs at a `chat.maxFetchCount` above the deletion count, so dropping the limit from `select_deletions` fails no chat test. Run path with no test: `chat.maxFetchCount` 2, three deletions, `after_seq` non-zero, `after_delete_seq` 0
- server/core/chat/index.ts:333: medium `chat` `### receive` says `GetChatMessages` on a `Direct` channel does not look at blocks or the other user's withdrawal, and no test reads a `Direct` channel after either. The `Direct` reads in server/core/chat/tests/direct.test.ts:59-75 and server/core/chat/tests/send-rules.test.ts:70 run with no block and no withdrawal. A block or `is_active_user` check added to this path fails no chat test
- server/core/chat/index.ts:371: medium `chat` `### report` step 4 maps `LIMIT` to `REPORT_LIMIT` and `INVALID_INPUT` to `INVALID_REQUEST`, and no test goes through either failure path. A search of server/core/chat/tests finds no `REPORT_LIMIT`, `block-report.maxReportsPerWindow` or `block-report.maxEvidenceBytes`, and no other module's tests send `ReportChatMessage`. Run path with no test: `block-report.maxReportsPerWindow` 1 and two reports of different messages by one user
- server/core/chat/index.ts:442: medium `chat` `### delete` step 6 leaves the deleting user ID, the guild ID and the seq in an `info` log, and no test checks that log. The text of the log line is only in server/core/chat/index.ts, and server/core/chat/tests/guild.test.ts:65-84 asserts only response codes and rows. Removing this line fails no chat test

## debt

none

## must fix

none

## unknown

- `ogw core test server chat` printed `chat pass` on the range end commit. The output does not say whether it was a new run or a kept result, or whether the PostgreSQL cases ran on this host, so the tests marked PostgreSQL are read but not confirmed as run
- The `## out of scope` test gaps were found by reading and searching the tests. The statements that a code change fails no chat test were not checked by restoring a defect in a temporary copy
- `guild`, `friend`, `admin-api` and `storage` code was not read in full. Their behavior was taken from their specs, apart from the `routing` handling of a handler's `INTERNAL` result, which was read in server/core/routing/pipeline.ts
- In the commit range, the files under server/core/coupon, server/core/matchmaker/tests, server/core/routing/tests, client/, tools/ and records/, server/core/Dockerfile, client/godot generated settings and the other core-spec files (MessageCore, QACore, coupon, matchmaker, user-snapshot-clone) were not read. None of them is in server/core/chat or in a module chat depends on. The range changes no file in server/core/chat, in the code of a chat dependency, or core-spec/chat.json. Of the range changes chat could reach, core-spec/validation.json, settings/core-settings.json, settings/core-settings.schema.json, server/core/testing/dev/setting_types.ts and the matchmaker settings reader were read, and chat does not read the keys they add or remove
- Client `ChatCore` is outside this target and was not read
