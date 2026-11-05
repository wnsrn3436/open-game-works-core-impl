# PaymentCore review round 11

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D13 | fixed | none | The error table of `open-game-works-core/skills/client-core/modules/payment-core.md:211` now has the row `` `list_unfinished`, `list_owned` failure `` → `false` for `recover_purchases`, `restore_purchases`, log `error`, and `:98` makes a call that does not end within `PaymentCore.storeCallTimeoutMs` a failure, so a timeout falls under the same row. A failure after the login session ended falls under the row of `:220` (log `none`). The code matches: `client/godot/core/payment_core/payment_core.gd:600` and `:643` log `error` only after the `life`/`epoch` checks of `:596` and `:639`, and `client/godot/core/payment_core/tests/test_recovery.gd:495` and `:606`-`:609` assert one PaymentCore error log per failed list, which the spec now requires |

## must fix

none

## unknown

- The commit range `14068d9..14068d9` is empty, so there were no changed places to review; the review covered only the previous round and the input `## debt` item
- The previous review `records/review/PaymentCore-10.md` has no `## findings` rows and no `open` rows in `## previous`, so `## previous` is `none`
- No tests were run in this round: D13 was closed by a spec row that matches the existing code and tests, which round 10 ran and found passing
