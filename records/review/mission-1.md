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

- The commit range `625ae189..47402535` changes no file under `server/core/mission/` and no line of the mission spec. Checked the changes of the range in the modules that mission calls or that run its requests, against `server/core/mission/index.ts`, `server/core/mission/deps.ts` and `server/core/mission/dev/index.ts`:
  - `item-ledger` (`server/core/item-ledger/ledger.ts`, `server/core/item-ledger/history.ts`): a throwing or wrong-output `validate_item_change` / `after_item_change` hook now calls `storage.fail_transaction`; misuse throws without a log; the `once_key` table keeps the SHA-256 form; history `source` is read as the enum value. Mission does not catch a throw of `mailbox.grant_or_mail` (`server/core/mission/index.ts:193`), and `grant_or_mail` does not catch a throw of `add_items` (`server/core/mailbox/index.ts:298`), so a throwing item hook ends `ClaimMission` as `INTERNAL` with progress, `claimed` and items unchanged before and after the range. A rejecting hook (a `GameError` return) still reaches `mail_items` (`server/core/mailbox/index.ts:304`), so claim step 6 `Mailed` is unchanged. The mission `once_key` `mission:<id>:<event_round>:<reset_at>` is ASCII, so the new unpaired-surrogate refusal of `resolve` never applies to it, and hashing keeps one row per distinct key, so the claim-once-per-reset behavior is unchanged
  - `storage` (`fail_transaction`, `TxState.failed`): mission does not call `fail_transaction`; the `get_state`, `get_states`, `put_core_state`, `with_hook_change_source`, `check_hook_output` that mission uses (`server/core/mission/deps.ts:10`) are unchanged
  - `logging` (`server/core/logging/metrics.ts`): only an alert window comment changed; `track_core_event` is unchanged
- `mailbox`, `live-event`, `validation`, `server-time` have no code change in the range and were read only where mission calls them (`grant_or_mail`, `is_in_active_window`, `round_to_write`, `is_round_reset`, `evaluate_requirement`, `get_next_reset`)
- The mission tests do not assert history rows, the `once_key` table form or item-ledger hook logs, so the changed values of those do not reach them. `ogw core test server mission` on this checkout passed (job `mw8m9pam68864c`, `mission pass`)
- Problems of mission that existed before the range and are unrelated to its changes were not searched for, as the scope of this round is the commit range
