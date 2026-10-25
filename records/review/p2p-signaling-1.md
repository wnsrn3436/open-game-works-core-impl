# review p2p-signaling round 1

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

- The commit range 2ef5ae8..a1ef113 changes no file under `server/core/p2p-signaling/`. The changed files that the module or its tests reach were checked against the module: `server/core/storage/tests/helpers.ts` (only `new_user` and new `new_users` changed; `server/core/p2p-signaling/tests/helpers.ts:12` imports only `core_settings`, `new_db`, `stop_all`, `test_server`, which did not change), `server/generated/contract/core_contract.ts` and `proto/ogw/core.proto` (only `BanDetail`, `AuthResult`, `PublicProfileEntry` and the new `FindUserByPublicCode*` messages; `MatchmakerFrame`, `Transport`, `TransportRelay`, `MatchPlayer` are unchanged), `settings/core-settings.json`, `settings/core-settings.schema.json` and `server/core/testing/dev/setting_types.ts` (no `p2p-signaling.*` key changed), `server/core/routing/spec_tables.ts` (the `p2p-signaling` dependency row is unchanged). No change in the range reaches p2p-signaling behavior, so there is no finding.
- The whole module (`index.ts`, `sessions.ts`, `turn.ts`, `adapters/turn_coturn.ts`, `dev/`) and its tests were also read against `skills/server-core/modules/p2p-signaling.md`, looking for pre-existing problems of severity `medium` or higher to put in `## out of scope`. None was found. Severity `low` was not recorded, because the review has a commit range.
- The tests were not run. `server/` of this checkout has no `node_modules/`, and installing it would write files outside `output`. The result above comes from reading the code, not from a test run.
- `matchmaker`, the caller of the four operations, is outside the target and was not reviewed. It did not change in the range.
