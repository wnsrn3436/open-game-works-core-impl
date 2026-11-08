# review: tutorial round 1

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

- The commit range 85f6b36d..d4bc885d changes no file under `server/core/tutorial/`. The review covered the changes of that range in what tutorial calls: `storage` (`get_state`, `put_core_state`, `delete_core_state`; the range adds the DB meter, `make_seed`, `read_db_metrics`, `watch_db_wait` and moves the seed provider call before the ctx is made, with the provider now taking request ID, user ID and request name), `logging` (`write`, `track_core_event`; the range adds `### metrics` recording after each written line), `validation` (only tests changed), the generated core contract (no change to `SaveTutorialProgressRequest`, `SaveTutorialProgressResponse` or `TutorialProgressUserState`) and `testing` `new_test_instance`, which the tutorial tests start through. None of these changes the input, output, failure value or order that `server/core/tutorial/index.ts` and `server/core/tutorial/dev/index.ts` rely on
- `ogw core test server tutorial` passed on this checkout. The tests of `storage`, `logging`, `routing` and `testing` themselves were not run: they belong to the reviews of those modules
- Problems of the tutorial code that existed before the range and that the range does not reveal were not looked for, as the commit range is not `none`
