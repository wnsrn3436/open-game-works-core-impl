# review remote-config round 1

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

- The commit range 85f6b36d..e243fcbc changes no file under `server/core/remote-config/`, does not change the remote-config spec (`## spec changes` is `none`), and changes no `remote-config.*` key in `settings/core-settings.json` or `settings/core-settings.schema.json` (`server/generated/core_settings_schema.json` gives `remote-config.cacheMs` minimum 1, `remote-config.maxGroups` minimum 2 and `remote-config.maxStringBytes` minimum 1, which fits `## settings` of the spec). The generated contract only adds the `LogoutOtherDevices` messages; `RemoteConfigValue`, `RemoteConfigEntry`, `ExperimentAssignment` and `GetRemoteConfigResponse` are unchanged
- The changes the range makes in the modules remote-config calls were read where remote-config reaches them: `storage` (the `DbMeter` and `counting_adapter` wrapping of `read_db`, `db(tx)` statements and transaction starts in `server/core/storage/db/meter.ts`, which return the inner results unchanged and only count; the WAL retry at SQLite open; the seed provider signature and `make_seed`, which remote-config does not call; `watch_db_wait` and `read_db_metrics`), `logging` (`read_metrics` and the metric count of each written line in `server/core/logging/index.ts`; `write`, which remote-config calls, still takes the same entry), and `routing` (the server process with request workers, in which each worker thread is one server instance with its own remote-config cache and `remote_config_cache` job, as `### server process` of the routing spec defines; the pipeline changes of step detail texts, `duration_ms` and the minimum app version judgement). `server-time` has no change in the range. `auth/login.ts` (the caller of `get_client_config` through `Login`) only adds login token expiry before the login. None of these changes the values or rows remote-config reads, the order of its calls, or its lock of key 0 of `remote_config_experiment`. Under `routing.requestWorkers` 2 on SQLite, concurrent `put_experiment` calls on two request workers are serialized by the SQLite write lock that `BEGIN IMMEDIATE` takes (`server/core/storage/db/sqlite.ts:348`), so the overlap check still runs one at a time
- `ogw core test server remote-config` in this worktree at e243fcbc gave `remote-config pass`
- The remote-config code outside what the range reaches was not reviewed, because a review with a commit range reviews only problems that the range causes or reveals. In particular, whether the request-start cache view (`view_of`, `server/core/remote-config/index.ts:327`, taken at the first remote-config read of a ctx rather than at transaction open as `## behavior` says) can be observed to differ was not checked
