# review push round 1

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

- The commit range 85f6b36d..6e018585 changes no file under `server/core/push/`. The review covered the changes in that range that push calls or that call push: `storage` (`db/meter.ts` counting adapter and DB wait state, `db/sqlite.ts` cross-connection `BEGIN IMMEDIATE` retries and WAL open retries, `db/postgres.ts` meter, `tx.ts` seed provider and `make_seed`), `logging` (`metrics.ts`, `read_metrics`, the metric line after each written log line), `auth` (`LogoutOtherDevices`, `revoke_login_tokens`, login token idle expiry) against the `session.check_current` rule of `### device registration`, and `routing` (settings check of `create_server` against `server/generated/core_settings_schema.json`, `run_server_process` with several worker instances on one DB, `routing_ops_report`). No change of those alters the behavior that push relies on: the `StorageApi` operations push calls (`register_table`, `db`, `read_db`, `run_game_transaction`, `lock_game_row`, `get_state`) keep their signatures and results; the schema properties of the `push.*` keys match the ranges of push `## settings` (`pollIntervalMs`, `sendTimeoutMs`, `retryMaxAttempts` minimum 1); the cross-key start checks of push (`push.leaseMs` condition, equal night minutes) stay in `server/core/push/index.ts`; a device of a session ended by `revoke_login_tokens` or left non-current by `LogoutOtherDevices` fails `session.check_current` at send
- `ogw core test server push` was run on this checkout and passed. The run on the PostgreSQL adapter depends on the host's `OGW_POSTGRESQL`; which DB kinds that run covered was not read from its output beyond the `push pass` lines
- Push was not run end to end inside `run_server_process` with several request workers (a real server process sending pushes from the `push_send` job of each worker instance). The multi-instance behavior of push (lease, `push_held` delete, `push_target_lock`) was checked only by reading the code and by the existing two-instance tests in `server/core/push/tests/lease.test.ts` and `send.test.ts`
- The real `push-fcm` and `push-apns` adapters were not called against FCM or APNs
