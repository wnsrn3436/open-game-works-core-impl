# review offer round 1

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

- The commit range 85f6b36d..babe46c0 changes no file of `server/core/offer/`, no `OfferUserState` field of `server/generated/contract/core_contract.ts`, no row of `test-data/data/tables/offer.csv`, `tools/data-tool/src/checks/offer.ts` or `core-spec/offer.json`, and no file of `server/core/live-event/`, `server/core/server-time/` or `server/core/validation/` other than validation tests. Input `## spec changes` is `none`
- Checked the changes of the range in the dependency modules that offer calls: `server/core/storage/index.ts`, `server/core/storage/core.ts`, `server/core/storage/tx.ts` (seed provider signature, `make_seed`, DB meter, `read_db_metrics`) and `server/core/logging/index.ts` (metrics counted in `write`, `read_metrics`). `get_state`, `put_core_state`, `delete_core_state`, `logging.write` and `logging.track_core_event`, which `server/core/offer/index.ts` calls, keep their signatures and behavior for offer; the `error` log of `trigger_offer` for an unknown offer now also counts in the error log metric, which `logging` defines. offer and its tests use no changed storage member (`set_seed_provider`, `make_seed`, `watch_db_wait`, `read_db_metrics`)
- `ogw core test server offer` passed on this checkout (job mw7weg20c597e4, two runs reported `offer pass`)
- Code of offer outside the range (`server/core/offer/index.ts`, `server/core/offer/dev/index.ts`, its tests) was read for the call paths above but not reviewed again as a whole target, since problems from before the range that the range does not cause or reveal are not findings; none of `critical`, `high` or `medium` was seen while reading it
- The core tests of modules that call offer (`shop`, `iap`) were not run: their call paths into offer did not change in the range
