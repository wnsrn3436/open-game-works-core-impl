# review cheat round 1

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

- The commit range 625ae189..aca0d897 changes no file under `server/core/cheat/`. The review covered the cheat code (`server/core/cheat/dev/*.ts`) against the changes that reach it: `storage.fail_transaction` (`server/core/storage/core.ts`, `server/core/storage/tx.ts`, `server/core/storage/index.ts`), the item-ledger hook failure that calls it (`server/core/item-ledger/ledger.ts:448`) and the history `source` change (`server/core/item-ledger/history.ts`). cheat calls no `fail_transaction`, and its own storage calls (`storage.db`, `put_state`, `delete_state`, `register_table`, the `get_time_offset` query) run on transactions that routing opens. The cheat test that checks the history source (`server/core/cheat/tests/processing.test.ts:168`) reads `list_item_history` of admin-api, which still gives the element name the table keeps. No change of the range causes or reveals a cheat defect that I found
- `ogw core test server cheat`: the SQLite run passed. The PostgreSQL run of `server/core/cheat/tests/processing.test.ts` failed twice with different tests and timeouts: first `counts cheat requests on the game request user counter ... RATE_LIMITED` with `testing: wait_background did not end within 10000 ms`, then on a rerun of that file three tests with `Test timed out in 60000ms`. The host load average was 44 during these runs. Whether these are caused by load or by a defect was not checked. I did not run the file on the commit before the range, and I did not rerun it on an idle host
- Routing DEV code (dev access, processing order, audit log, `with_hook_change_source`) is not part of this target and was read only as far as the cheat tests drive it
