# review routing round 1

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

- Tests were not run: the checkout has no installed node_modules. The results below come from reading the code and tests
- What was checked in range 2ef5ae8d..4bc36b73 for routing:
  - `server/core/routing/pipeline.ts:588`: step 6 fills `BanDetail.public_code` from `storage.get_user_record(storage.read_db(), user_id)`, and an empty string when there is no record. This matches `routing.md` step 6 and `## error`, and `storage.md` (`get_user_record` gives an empty `public_code` for a null row). `proto/ogw/core.proto:47` has `string public_code = 6` in `BanDetail`
  - `server/core/routing/module_api.ts:97`: `StorageModule.get_user_record` was added. `storage` is in `## dependency` of routing, and `storage.md:59` lists `routing` as a caller
  - `server/core/routing/spec_tables.ts:69`: the request prepare row `core/FindUserByPublicCode` → `public-profile.count_find_attempt` matches the `routing.md` request prepare table. `collect.ts` `collect_prepare` turns a missing operation into a start error. The `RedeemCoupon` `has_response` exception in `pipeline.ts` `prepare` is not applied to this rpc, which matches the spec. `server/core/public-profile/tests/requests.test.ts:267` goes through the server and fails when this prepare row is removed, because the 4th find would no longer be `RATE_LIMITED`
  - `server/core/routing/spec_tables.ts:96` and `:133`: `find_user_by_public_code` was added to the auth admin operations (caller `operator`, as in `auth.md:119` and `admin-api.md:63`), and `FindUserByPublicCode` was added to the public-profile core rpcs (`public-profile.md:31`). `server/core/auth/admin.ts:78` exports it, and `server/core/auth/tests/public-code.test.ts:12` reaches it through admin-api
  - `server/core/routing/tests/processing-order.test.ts:316`: the new assert compares `ban.public_code` with the stored record and the code format. It fails when the line in `pipeline.ts:588` is removed (empty string does not match the format)
- Code outside the routing module that this range changed (auth, storage, public-profile, other module tests) was read only where routing calls it or where it shows the routing change is used. It was not reviewed as a target
