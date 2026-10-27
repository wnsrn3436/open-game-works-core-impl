# PushCore review round 1

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

- The commit range cf89b7fd..bfd2066 changes no file under `client/godot/core/push_core/` and no PushCore spec (`core-spec/PushCore.json` is unchanged). On the client it adds an AuthCore test only (`client/godot/core/auth_core/tests/test_secure_storage_plugin.gd`), changes QACore DEV code (`client/godot/core/qa_core/dev/qa_core.gd`, `client/godot/core/qa_core/dev/qa_telemetry.gd`: release inputs are not recorded in telemetry), adds the macOS `ogw-secure-storage` plugin (`client/godot/plugins/ogw-secure-storage/`, `client/godot/engine.json`) and changes the generated core settings (`routing.ipRateLimitPerMinute`, `storage.sweepBatchSize`, `storage.sweepTableBudgetMs`)
- PushCore calls only `AuthCore.get_consent`, `AuthCore.update_push_consent`, `AuthCore.is_initialized`, `AuthCore.is_logged_in` and uses `AuthCore.SessionEndReason` and the AuthCore login and session events (`client/godot/core/push_core/push_core.gd:276`, `:354`, `:411`, `:421`). The range does not change `client/godot/core/auth_core/auth_core.gd` or its token storage adapters; the new plugin is reached only through `AuthCore._platform_storage` (`client/godot/core/auth_core/auth_core.gd:243`), which is unchanged. PushCore does not call QACore and does not read any of the changed settings keys
- The PushCore test support inits AuthCore and logs in through `AuthCoreDev.dev_login` (`client/godot/core/push_core/tests/support/push_test_env.gd:61`, `:135`); none of these are changed by the range. `ogw core test godot PushCore` ran on this checkout at bfd2066 and passed (61 of 61, job mvqlpogmd2ee01)
- The server changes of the range (`server/core/ads-reward/`, `server/core/routing/`, `server/core/storage/`, test files of coupon, idempotency, item-ledger, mailbox) are server code, not the client PushCore target, and contain no push change; they were not reviewed here
- The rest of PushCore was not reviewed aspect by aspect, because the range does not reach it
- The FCM and APNs real adapters and their plugins were not run on a device. Only the core test run above, on the host, covers them
