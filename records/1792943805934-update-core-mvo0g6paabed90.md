# update core: public user code

## done

- storage (`server/core/storage/`)
  - `public_code.ts`: user IDs are secure random integers of 1 or more and below 2^53 (`pick_user_id`). Public codes are 8 secure random characters of `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (`pick_public_code`). `normalize_public_code` turns a text into its code by the public code input rule.
  - `rows.ts`: `create_user` returns `{ user_id, public_code }`. It inserts with `ON CONFLICT DO NOTHING`, so a taken `user_id` or `public_code` (a withdrawn user's row included) inserts nothing, and then it picks both values again. `get_user_record` now also gives `public_code`. New `find_user_by_public_code`: a withdrawn user is found; a text that is not a public code input, or that no row has, gives none.
  - `schema.ts`: core schema version 2, and `core-schema-version` is now 2. Version 2 adds `"user".public_code` (string?) and the unique index `ix_user_public_code`. Inside the schema lock transaction, after the schema changes, every null `public_code` row is filled. The fill update writes only while the row is still null and no row has the picked code, and picks again otherwise.
- auth
  - `AuthResult.public_code` is filled.
  - The ban login's `BanDetail.public_code` is filled.
  - New admin operation `find_user_by_public_code` (`read`; `bad_request` / `not_found`; output `user_id`, `withdrawn_at`).
  - The web account deletion `code` method uses the field `public_code`, not `user_id`. A text that is not a public code input is 400. The user is found with `storage.read_db`. A throw from that lookup is 500 `[auth_deletion_retry]` with one `error` log.
- routing
  - Step 6 `BanDetail.public_code` comes from `get_user_record(read_db)`.
  - `FindUserByPublicCode` is in the request prepare table (`public-profile.count_find_attempt`), the core rpc table and the auth admin operation list.
- public-profile
  - `PublicProfileEntry.public_code` is filled.
  - New `FindUserByPublicCode` (not silent): `INVALID_REQUEST`, or `USER_NOT_FOUND` for no user or a withdrawn user.
  - New `count_find_attempt`, with the table `public_profile_find_counter` (user scope, expiry `expires_at`, snapshot `false`). Its results are `RATE_LIMITED`, `UNAUTHORIZED` and `INTERNAL`, the last with an `error` log.
  - Reads the setting `public-profile.findPerMinute`.
- admin-api: the operation table row comes through the auth export and routing's `MODULE_ADMIN_OPERATIONS`.
- base proto (`proto/ogw/core.proto`)
  - New fields `BanDetail.public_code = 6`, `AuthResult.public_code = 10`, `PublicProfileEntry.public_code = 5`.
  - New rpc `FindUserByPublicCode`, with `FindUserByPublicCodeRequest` (`public_code`, `max_len: 32`) and `FindUserByPublicCodeResponse` (`profile`).
  - The server and Godot generated code is regenerated.
- core settings: added `public-profile.findPerMinute` = 10 with `ogw settings set core`. Its schema entry (`minimum: 1`) is in `core-settings.schema.json`.
- Godot AuthCore
  - New `get_public_code`. It gives the code of the session, else of the ban session, else an empty string and an error log.
  - `LoginResult.public_code` is set for `Success` (login, auto login, `dev_login`, `switch_account`) and for `Banned`.
  - The session and the ban session keep the public code.
- Godot BootstrapCore: the ban body and the deletion code popup use the format argument `public_code` in place of `user_id`.
- Benchmark game (`benchmark/godot/`)
  - The texts `[bootstrap_banned]`, `[bootstrap_banned_permanent]` and `[bootstrap_banned_deletion_code]` use `{public_code}`.
  - `[auth_deletion_user_id]`, `[auth_deletion_body]`, `[bench_user_id]` and `[bench_copy_user_id]` now say user code. Their `en.csv` hashes were recomputed with the data tool's `hash16`.
  - The option panel shows and copies `AuthCore.get_public_code` in two groups of 4 joined with `-`.
  - The copied generated `core_contract.ts` and `core_contract.gd` are updated.
- Core tests: every new `## test` item has at least one test.
  - storage: `tests/public-code.test.ts` and `tests/create-user-conflict.test.ts`. The conflict test queues picks through a vi.mock of `public_code.ts`.
  - auth: `tests/public-code.test.ts`, plus additions to `login`, `ban`, `deletion` and `deletion-form`.
  - public-profile: `FindUserByPublicCode` tests in `requests.test.ts`, and a `count_find_attempt` test in `profiles.test.ts`.
  - routing: step 6 `public_code`, and the collection of the new admin operation.
  - Godot: `test_login.gd` (`get_public_code`, ban `public_code`), `test_account.gd` (switch account `public_code`), `test_boot_login.gd` (`public_code` format arguments).
- Existing tests in many modules assumed user IDs come out in creation order from 1. I changed them to compute the expected order from the IDs: storage, auth, chat, friend, guild, migration, nickname, public-profile, push, ranking, user-snapshot-clone and routing, plus the `create_user` callers in test helpers. No implementation relied on creation order; the lists are ordered by user ID as the specs say.
- Last runs
  - `ogw core test server` (all modules): pass.
  - `ogw core test godot` and `ogw core test godot --web` on the 18 client dependents of AuthCore and BootstrapCore: pass.
  - `ogw core test tools`: pass.
  - `ogw code check core`: pass.

## spec proposals

- storage `## API` has no operation for "is this text a public code input". auth step 2 (400 against 403), `FindUserByPublicCode` (`INVALID_REQUEST` against `USER_NOT_FOUND`) and the admin operation (`bad_request` against `not_found`) all need that answer, and `find_user_by_public_code` gives none for both cases. I export the pure function `normalize_public_code` from `server/core/storage/index.ts`, and auth and public-profile import it. Proposal: add `is_public_code_input` (text → bool) to the storage API, or give `find_user_by_public_code` a separate result for a text that is not a public code input.
- `get_user_record.public_code` when the column is null: the spec says null happens only until server start fills it. During a rolling deploy, though, a server of an earlier core version can insert a row after a newer server's fill. I return an empty string for null. Proposal: the spec states that value, or every reader treats an empty code as no code.
- BootstrapCore passes `public_code` as the raw 8 characters, as the spec says. The `client-content` rule shows a public code to a person in two groups of 4 joined with `-`. Proposal: BootstrapCore passes the grouped form, or the spec says which form the ban and deletion texts get.

## review

none

## unverified

- On PostgreSQL, the start fill's `NOT EXISTS` guard does not see a code that a running server instance has inserted but not committed. If the fill picks that same code at that moment (about 1 in 2^40 per row), the unique index makes the schema transaction fail, so that server start fails; the next start succeeds. I did not add a savepoint retry for it, and I did not reproduce it.
- Other tests may still assume creation order but pass about half the time by chance. The last full server run passed, and 3 such flakes surfaced only on a second full run and were fixed. I did not audit every test file.
- The test-order fixes in chat, friend, guild, migration, push, nickname, public-profile, ranking and user-snapshot-clone were made by sub-agents I started in a workflow; I checked their reports and the full runs. I did not read each of their diffs line by line.
