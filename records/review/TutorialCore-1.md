# review TutorialCore round 1

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

- The commit range cf89b7f..a5c3cb5 changes no file under `client/godot/core/tutorial_core/` or `server/core/tutorial/` (`git diff --quiet` of those paths over the range is clean), and `## spec changes` is `none`. So TutorialCore code and tests outside the range were not reviewed
- Changed code that TutorialCore reaches, checked and found not to change TutorialCore behavior:
  - Client `AuthCore`: only `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd` was added; no AuthCore source file changed (`git diff --quiet` of `client/godot/core/auth_core` without `tests` is clean). TutorialCore calls only `AuthCore.is_logged_in` (`client/godot/core/tutorial_core/tutorial_core.gd:438`). The new macOS `ogw-secure-storage` plugin (`client/godot/plugins/ogw-secure-storage/`, `client/godot/engine.json:55`) is used through AuthCore; whether it changes `AuthCore.is_logged_in` on macOS is in the review scope of AuthCore, not TutorialCore, and was not checked
  - Server `storage`: server `tutorial` uses only `get_state`, `put_core_state` and `delete_core_state` (`server/core/tutorial/index.ts:10`), none of which changed. The range changes `sweep_expired` (`server/core/storage/rows.ts`), the expiry column index of `table_def` and `CREATE INDEX IF NOT EXISTS` (`server/core/storage/schema.ts`), the two new settings `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, and the code of a wait for a free PostgreSQL connection (`server/core/storage/db/pg_messages.ts:53`, now `POOL`), which `server/core/storage/db/postgres.ts:19` still classifies as a lock failure, so the failure a tutorial request sees is unchanged. `TutorialProgressUserState` rows have no expiry column (no `expiry` in `server/core/tutorial/index.ts`)
- QACore, ads-reward, routing and the other server changes in the range are not in the dependency of TutorialCore or of server `tutorial` and were not reviewed
- Tests were not run
