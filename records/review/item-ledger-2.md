# review item-ledger round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commits 83fd3764 and 22ddb5c0 add `server/core/item-ledger/tests/once-key-routing.test.ts:69`. It starts a test server with `routing` (`start_test_server` with its own `register`, :70) and a content `RunCoreTest` handler that calls the content `add_items` with `once_key` `shop:1` and does not catch the throw (:24-:29). It checks the `INTERNAL` answer (:76), that the only `error` kind line of the request is `routing`'s `unhandled exception` with a stack trace (:78, :80), the `request` line's `error_code` `INTERNAL` (:79), no line with `module` `item-ledger` (:81), and that the balance, `list_history` and the `item_ledger_once_key` rows stay the same (:82-:84), with a control request (`content:1`) showing those reads see a change (:87-:94). This covers `## test` of item-ledger.md ("`add_items` called by content code with `once_key` `shop:1` throws, the request is `INTERNAL`, ... and an `error` log is left") through `routing`, as the `## error` row for a content `once_key` with a core prefix sets. `ogw core test server item-ledger --file server/core/item-ledger/tests/once-key-routing.test.ts` (job mw8pimz43470dc) passes on SQLite and PostgreSQL at 1e1285cb. Restored defects, each in a worktree from `git worktree add --detach` of 1e1285cb: (1) the `this.error_log(exchange, 'unhandled exception', error)` line of `server/core/routing/pipeline.ts:240` commented out: the test fails on SQLite and PostgreSQL (job mw8pijkgdbba84, `expected [] to deeply equal [ [ 'error', 'unhandled exception' ] ]`); (2) an `error` log by item-ledger (`this.error(ctx, ...)`) added before the throw at `server/core/item-ledger/ledger.ts:422`: the test fails on both DBs (`expected [ [ 'error', …(1) ], …(1) ] to deeply equal [ [ 'error', 'unhandled exception' ] ]`) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `server/core/item-ledger/tests/once-key-routing.test.ts` of item-ledger changed in the range. The other changes of the range (`server/core/iap/tests/gone.test.ts`, client core modules under `client/godot/`, files under `records/`) belong to other review targets and were not reviewed.
- Only the new test file was run (`--file`), on the current code and on the two restored copies. The other item-ledger tests and the modules that depend on item-ledger were not run here; the core agent report records a passing `ogw core test server` of item-ledger and its server dependents (job mw8ncyejf2ed54).
- Client modules were not run; no client file of item-ledger changed.
