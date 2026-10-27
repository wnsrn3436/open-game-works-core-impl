# RealtimeCore review round 1

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

- The commit range cf89b7fd2768ede33b78f5948fb0fae06df506e2..4508d5f8bb5f4ee0ccf1e2f636026195b08de8e4 changes no RealtimeCore code, test or spec (`client/godot/core/realtime_core/` and `core-spec/RealtimeCore.json` are not in the diff), no contract file, and no code of the client modules in `## dependency` of the RealtimeCore spec. AuthCore changes only by the new test `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd`
- The new `ogw-secure-storage` macOS plugin item (`client/godot/engine.json:55`) loads a GDExtension in the Godot editor that runs the core tests. AuthCore picks its storage with `Engine.has_singleton("OgwSecureStorage")` (`client/godot/core/auth_core/adapters/secure_storage_adapter.gd:43`, `client/godot/core/auth_core/auth_core.gd:243`), which is unchanged; the new AuthCore test asserts that the editor has no singleton and keeps the DEV token storage, so the AuthCore setup of the RealtimeCore tests (`client/godot/core/realtime_core/tests/support/realtime_test_case.gd:132`) keeps the same storage. Not run on a macOS host in this review
- The server `matchmaker` and `p2p-signaling` modules have no code change in the range. `matchmaker` reaches the changed `storage` code through its two tables with expiry column `expires_at` (`server/core/matchmaker/records.ts:190`): `register_table` now adds an index on `expires_at` to both tables (`server/core/storage/schema.ts:186`), and `sweep_expired` now deletes them in batches per table (`server/core/storage/rows.ts:386`). The match and participant rows were already deleted by separate autocommit statements before the range, and `read_match` treats an expired row as absent (`server/core/matchmaker/records.ts:278`), so no RealtimeCore-visible behavior was found to change. The RealtimeCore client tests use the fake network and the fake realtime transport and do not reach this server code
- The changed core settings (`routing.ipRateLimitPerMinute`, new `storage.sweepBatchSize`, `storage.sweepTableBudgetMs` in `client/godot/generated/core_settings.json:95`, `:484`) are not read by RealtimeCore or its test setup
- Read only; the RealtimeCore tests were not run in this review, because no code they run changed in the range
