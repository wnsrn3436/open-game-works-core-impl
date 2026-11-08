# review GameUpdateCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/game_update_core/deploy_list.gd:13 | Debt D1, still open. `is_version` (`deploy_list.gd:62-71`) rejects a part longer than `_VERSION_PART_MAX_DIGITS` (18) digits. `game-update-core.md` `### deploy list` format check only says "version is `<major>.<minor>.<patch>`", with no digit limit. Server publish `version_at` (`server/core/game-update/deploy_list.ts:89`) uses `VERSION` `/^(0\|[1-9][0-9]*)\.(0\|[1-9][0-9]*)\.(0\|[1-9][0-9]*)$/` (`deploy_list.ts:56`), and `validation.parse_version` (`server/core/validation/helper.ts:108`, BigInt parts) has no digit limit either. Run path: the operator publishes `app.android.min_version` `1.0.1000000000000000000` (19 digits) → server accepts it → client `check` → `_check_platform_entry` (`deploy_list.gd:223`) sets `error` "platform entry version form" → every android client gets `[game_update_invalid_file]` and the fetch failure popup on each retry until the next publish. The server's `is_below_min_version` reads the same entry without trouble, so client and server judge differently | Make the client accept exactly what the server publish accepts: drop the digit limit, and compare parts as decimal strings (after removing leading zeros: longer string is greater, equal length compares lexically) instead of `to_int`. Or set one shared digit limit in `game-update-core.md` and `game-update.md`, and have server publish reject versions longer than it. Add a core test with a 19-digit part | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `deploy_list.gd` has not changed since 301b3dd8 (`git log -- client/godot/core/game_update_core/deploy_list.gd`). `_VERSION_PART_MAX_DIGITS` = 18 is still checked in `is_version` (`deploy_list.gd:67`). Server `VERSION` regex (`server/core/game-update/deploy_list.ts:56`) and `validation.parse_version` still have no bound |

## must fix

none

## unknown

- The commit range `625ae189..625ae189` is empty, so no change-caused findings could exist. Read only the D1 position: `deploy_list.gd` (`is_version`, `compare_versions`, `_check_platform_entry`), server `game-update` `deploy_list.ts` (`VERSION`, `is_app_version`, `version_at`, `stored_min_versions`), `cache.ts` `below_min_version`, `validation/helper.ts` `parseVersion`, and the version text of `game-update-core.md` and `game-update.md`. The rest of the target was not reviewed again in this round
- Tests were not run. R1-1 was confirmed by reading the code paths. No restore of the defect was needed because the round is 1
