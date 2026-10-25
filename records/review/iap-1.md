# review iap round 1

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

- `server/core/iap/` has no change in the range 2ef5ae8d..4bc36b7 (`git diff --stat` of that range over `server/core/iap` is empty; the module is unchanged since the initial commit). The range changes that reach iap were checked: `storage` user ID picked at random below 2^53 and `create_user` returning `{ user_id, public_code }` (`server/core/storage/rows.ts:56`), core schema version 2 with the start fill of `public_code` (`server/core/storage/schema.ts:217`, `server/core/storage/schema.ts:317`), `get_user_record` with `public_code`, `find_user_by_public_code`, `routing` `BanDetail.public_code` (`server/core/routing/pipeline.ts:588`), the new `FindUserByPublicCode` RPC and the proto fields added to `BanDetail`, `AuthResult` and `PublicProfileEntry` (`proto/ogw/core.proto`), and the `auth` deletion form by public code (`server/core/auth/deletion.ts:174`). iap does not call `create_user`, `get_user_record` or `find_user_by_public_code`; it handles user IDs only as `bigint` (`int64` columns in `server/core/iap/tables.ts:81`, `big()` reads in `server/core/iap/tables.ts:231`); the account token takes the decimal string of any user ID (`server/core/iap/account_token.ts:8`), so a random user ID below 2^53 gives the same 36-character UUID form; `OTHER_USER` owner 0 for none stays apart from user IDs, which are 1 or more; the iap tests make users through `testing.login` (`server/core/iap/tests/helpers.ts:29`) and do not assume sequential user IDs or a user ID order (the only literal user ID is the unit stub `server/core/iap/tests/purchase-count.test.ts:35`); no proto message or field number used by iap was changed. No finding comes from these changes
- iap code that existed before the range and that these changes do not reach was not reviewed in full. The grant order judgement (`server/core/iap/grant.ts:546`-`server/core/iap/grant.ts:693`) was read against `### grant order` step 4 to 9 and no problem was found there; `notify.ts`, the adapters (`adapters/apple.ts`, `adapters/google.ts`, `adapters/jws.ts`), `index.ts`, `purchase_count.ts`, subscription apply and recompute, ownership transfer and refund handling in `grant.ts` were not checked line by line against `iap.md`
- The tests were not run: the checkout has no installed `node_modules`, so the iap tests and the type check were not executed in this review
