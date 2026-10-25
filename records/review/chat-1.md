# review chat round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The chat tests were not run. Running them needs the inputs that `ogw core test` gives (`OGW_SERVER_DATA`, fixtures, a PostgreSQL URL), and this review writes no file outside `output`. The judgement below comes from reading the code and tests.
- Changes of the range that reach chat, checked by reading: random user IDs below 2^53 (`server/core/storage/public_code.ts:16`, `server/core/storage/rows.ts:57`); `public-profile.get_public_profiles` reading `storage.get_user_record` in place of `is_active_user` and filling `PublicProfileEntry.public_code` (`server/core/public-profile/index.ts:205`); the auth web deletion by public code (`server/core/auth/deletion.ts:224`), which still calls `remove_user` through the same withdrawal path; and the two test changes in `server/core/chat/tests/direct.test.ts:122` and `server/core/chat/tests/direct.test.ts:153`.
- chat code is the same in this range. Its user ID handling (`min_big`/`max_big` channel keys at `server/core/chat/index.ts:150`, the `remove_user` lock order at `server/core/chat/index.ts:476`, the bigint compares in the `GetChatChannels` sort at `server/core/chat/index.ts:369`, and `big()` in `server/core/chat/tables.ts:141`, which takes safe-integer numbers) is correct for random IDs below 2^53.
- The other chat tests were read for expectations that depend on users being made in ascending user ID order. The tests in `direct.test.ts`, `world.test.ts`, `send-rules.test.ts`, `report-delete.test.ts`, `guild.test.ts`, `lock.test.ts`, `withdraw.test.ts`, `modules.test.ts` and `child.test.ts` use different `last_at` values, `direct_key`, or sorted expectations, so none depends on that order. `child.test.ts` and `modules.test.ts` were only searched, not read in full.
- The test at `server/core/chat/tests/direct.test.ts:209` inserts block rows for user IDs 1000000001 to 1000040000. With random IDs, a test user's ID could fall in that range, but the chance is about 4·10^-12 per user, so it is not a finding.
