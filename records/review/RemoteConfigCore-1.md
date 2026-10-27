# review RemoteConfigCore round 1

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

- The commit range cf89b7f..8fdb139 changes no RemoteConfigCore file: `git diff --stat` shows no change under `client/godot/core/remote_config_core/`, and `core-spec/` changes only `ads-reward.json` and `storage.json`. Input `## spec changes` is `none`. So I reviewed only whether the changes in the range reach RemoteConfigCore code or tests
- Dependencies (`LogCore`, `EventCore`, `TimeCore`, `DataCore`, `NetworkCore`, `AuthCore`): the only change under them is the new AuthCore test `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd`. `auth_core.gd` and the AuthCore adapters are unchanged, so `is_initialized`, `is_logged_in`, `get_login_remote_config` and `LoginCompletedEvent`, which RemoteConfigCore uses, are unchanged. The contract (`proto/`) is unchanged
- The range adds the macOS `ogw-secure-storage` plugin build (`client/godot/plugins/ogw-secure-storage/`, `client/godot/engine.json`). Its entry registers the `OgwSecureStorage` singleton only when the app has a keychain access group (`client/godot/plugins/ogw-secure-storage/macos/src/register_types.mm:22`). The Godot editor that runs the core tests has none, so `secure_storage_adapter.gd` returns `UNSUPPORTED` as before, and the RemoteConfigCore test login `AuthCoreDev.dev_login` (`client/godot/core/remote_config_core/tests/support/remote_config_test_case.gd:105`) uses the same token storage as before the range. I checked this by reading the code; I did not run the RemoteConfigCore tests, since they run through `ogw core test` and its test host, which a review agent does not start
- Server `remote-config` and `auth`: the range does not change `server/core/remote-config/` or `server/core/auth/`, so the login apply input (`AuthResult.remote_config`, `server/core/auth/login.ts:244`) is the same
- Generated core settings: the range changes `routing.ipRateLimitPerMinute` and adds `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`. RemoteConfigCore reads none of them (it reads `RemoteConfigCore.refreshIntervalMs`). The QACore change (release inputs in telemetry) is DEV code that RemoteConfigCore does not use
- I did not review the rest of RemoteConfigCore because the range did not touch it, and I did not review the new AuthCore test, the plugin source, QACore, server ads-reward, routing and storage code; they belong to the reviews of those modules
