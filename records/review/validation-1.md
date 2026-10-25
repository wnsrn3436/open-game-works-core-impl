# review validation round 1

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

- The core tests of `validation` were not run: this checkout has no installed test dependencies (`server/node_modules` is missing), and `ogw core test` is run by the lead agent. The only change to `validation` in the range, `server/core/validation/tests/server.ts:160` (`create_user(tx).user_id`), was checked against the new `Storage.create_user` signature that returns `NewUser` (`server/core/storage/index.ts:162`, `server/core/storage/rows.ts:51`). It was checked by reading, not by running a type check
- No code of `validation` outside `tests/` changed in the range. Its dependency on `storage` is only `run_read_only` and the `RequestCtx` type (`server/core/validation/index.ts:7`, `server/core/validation/index.ts:31`), and the range does not change them. The rest of the range (storage public code, public-profile `FindUserByPublicCode`, auth, routing, client modules) is outside the target and was read only where it reaches `validation`
- The generated validator of the new core `rpc` `core/FindUserByPublicCode` (`server/generated/contract/core_contract.ts:5949`, `max_len: 32`) is run by `validate_request` through `CoreContract.RPCS` (`server/core/validation/validator.ts:48`) with no change to `validation`. A boundary test of that request belongs to the module that owns the `rpc` and was not checked here
