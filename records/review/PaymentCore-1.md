# review PaymentCore round 1

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

- The commit range cf89b7f..bca7a64 changes no file under `client/godot/core/payment_core/`, no file under `server/core/iap/` and not `core-spec/PaymentCore.json`, and `## spec changes` is `none`. The review covered the changes in the range that PaymentCore reaches: `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd` (a new AuthCore test only; `client/godot/core/auth_core/auth_core.gd` and `client/godot/core/auth_core/adapters/secure_storage_adapter.gd` are unchanged, so `AuthCore.is_logged_in`, `list_linked_providers` and `is_provider_supported`, which `client/godot/core/payment_core/payment_core.gd:355`, `:473` and `:480` call, and the `AuthCore.init` path of `client/godot/core/payment_core/tests/support/payment_test_case.gd:131` are unchanged), the new `ogw-secure-storage` plugin entry in `client/godot/engine.json` and its sources under `client/godot/plugins/ogw-secure-storage/` (macOS only; per the new AuthCore test the Godot editor that runs core tests has no `OgwSecureStorage` singleton, so AuthCore token storage selection in PaymentCore tests is unchanged; PaymentCore does not read `engine.json`, and `client/godot/core/payment_core/adapters/plugin_store_adapter.gd:135` looks up only its own store singleton), `client/godot/core/qa_core/dev/qa_core.gd` and `qa_telemetry.gd` (release inputs in DEV telemetry; PaymentCore does not use QACore), and `client/godot/generated/core_settings.json` and `settings/core-settings.json` (`routing.ipRateLimitPerMinute` value and new `storage.sweepBatchSize`, `storage.sweepTableBudgetMs`; PaymentCore code and tests read none of them). PaymentCore code outside these call paths was not re-read, because it is unchanged in the range
- PaymentCore Godot tests were not run in this round, because `ogw core test` runs `ogw core spec` and the core project import, which write generated files into this checkout; the conclusion that the range does not change their behavior comes from reading the diff, not from a test run
- The server changes in the range (`server/core/storage/`, `server/core/routing/`, `server/core/ads-reward/`, the server test files of `coupon`, `idempotency`, `item-ledger`, `mailbox`) are not this client target, and their effect on the server `iap` module was not checked
- The `ogw-secure-storage` native sources (`client/godot/plugins/ogw-secure-storage/macos/src/`) and the prebuilt dylib were not reviewed; they belong to AuthCore, not this target
