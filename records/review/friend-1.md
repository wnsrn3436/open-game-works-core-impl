# review friend round 1

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

- The commit range 85f6b36d..86353a81 changes no file under `server/core/friend/` and no file of its dependencies' APIs that friend calls (`storage.register_table`, `storage.lock_game_row`, `storage.db`, `storage.get_state`, `server-time.now`, `nickname.find_user_ids_by_nickname`, `public-profile.get_public_profiles` / `is_active_user`, `block-report.is_blocked_either` / `register_block_listener`). Input `## spec changes` is `none`. The review checked the changed code of the range that friend runs under or that reaches it: `server/core/storage/index.ts`, `server/core/storage/tx.ts`, `server/core/storage/core.ts`, `server/core/storage/db/sqlite.ts`, `server/core/storage/db/postgres.ts` (DB meter wrapping of synchronous calls, seed provider moved before ctx creation, WAL retry at open), `server/core/routing/pipeline.ts` (step detail wording, minimum app version check, real-clock `duration_ms`), `server/core/auth/account.ts` and `server/core/auth/admin.ts` (new `LogoutOtherDevices` and `revoke_login_tokens`; the withdrawal path that calls `friend.remove_user` is unchanged), `server/generated/contract/core_contract.ts` (no friend message changed), and the settings check schema `server/generated/core_settings_schema.json` / `settings/core-settings.json`, whose `friend.*` keys (integer, minimum 0) and `chat.allowChild` (boolean) agree with the values `create_friend` accepts. None of them changes a result friend returns or its lock, transaction or hook order
- `ogw core test server friend` on this checkout passed (job mw7wn844f1998a). The internals of `server/core/storage/db/meter.ts` were not reviewed: they belong to `storage`, not to this target
