# review: mission round 1

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

- The commit range `85f6b36d..abd45c25` changes no file under `server/core/mission/`. Checked the changes of the range in the modules that mission calls or that run its requests, against `server/core/mission/index.ts`, `server/core/mission/deps.ts` and `server/core/mission/dev/index.ts`: `item-ledger` (history counter `seq`, separate `item-ledger.onceKeyRetentionMs`; the mission claim keeps `claimed` in the same transaction as the grant, so a `once_key` expiry does not allow a second claim before a reset), `storage` (seed provider, DB meter, `make_seed`; the `get_state`, `get_states`, `put_core_state`, `with_hook_change_source`, `check_hook_output` that mission uses are unchanged), `routing` pipeline (step detail texts, `min_version` in step 7, `duration_ms` clock), `logging` (metrics; `track_core_event` unchanged). No problem caused or revealed in mission was found
- The mission tests do not assert history `seq` values, `ServerError.detail` texts or `once_key` row expiry, so the changed values of those do not reach them. `ogw core test server mission` on this checkout passed (both runs reported `pass`)
- `mailbox`, `live-event`, `validation`, `server-time` code has no change in the range and was read only where mission calls it (`grant_or_mail`, `is_in_active_window`, `round_to_write`, `is_round_reset`, `evaluate_requirement`, `get_next_reset`)
- Problems of mission that existed before the range and are unrelated to its changes were not searched for, as the scope of this round is the commit range
