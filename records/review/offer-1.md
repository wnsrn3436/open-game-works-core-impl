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

- The commit range 9b1e14b..c36c234 changes no file of `server/core/offer/`, of its dependency modules (`validation`, `live-event`, `storage`, `server-time`, `logging`), of `shop` or `iap`, of `test-data/`, or `core-spec/offer.json`. No changed file outside `records/` mentions offer. The one change that reaches this module's data path is `tools/data-tool/src/corespec.ts` with `core-spec/validation.json` (`usedTables` gets `requirement`). It adds the enums of the `requirement` header and does not change the `offer` table or its data check. The whole of `server/core/offer/` and `tools/data-tool/src/checks/offer.ts` was still read against the spec for `## out of scope`
- `ogw core test server offer` passes at c36c234. The core tests of the modules that depend on `offer` (`shop`, `iap`) were not run, and in those two modules only the call sites of `read_purchase_limit` and `is_offer_active` were read
- The tests were run only with the default DB of that command. A run on PostgreSQL was not checked
- The tool suite of `tools/data-tool/` was not run, so `tools/data-tool/tests/offer-check.test.ts` and `tools/data-tool/tests/corespec.test.ts` were read but not run
- No test was checked by changing the target code in a temporary copy. Test strength was judged by reading the tests
- The branch of `read_state` in `server/core/offer/index.ts:82` for a stored row with `trigger_count` 0 is not reached by any test, and no code path writes such a row (`write_offer` deletes the row for 0, and `trigger_offer` writes 1 or more). It is not written as a finding, because the rule it implements, that a round reset reads as no row, is tested in `server/core/offer/tests/round.test.ts`
