# review push round 1

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

- The push tests were not run: `server/` has no `node_modules` in this checkout. Whether they pass is not checked
- The push source (`server/core/push/*.ts`) did not change in the range. In the range, push changed only in its tests (`tests/helpers.ts` `devices_in_id_order`, `tests/failure.test.ts`, `tests/lease.test.ts`, `tests/send.test.ts`), which follow the `storage` change to random user IDs (`server/core/storage/public_code.ts`, `server/core/storage/rows.ts` `create_user`). I checked the push code that reads user IDs (`send.ts` batch query `user_id > $1 ORDER BY user_id, device_token`, the starting cursor 0, `push_held` order `send_at, push_id, user_id`, `store.ts` target JSON `user_ids` as strings). It does not assume user IDs in creation order, and user IDs are 1 or more and below 2^53. I found no defect
- I read the push tests that make two or more devices and assert send order, cursor or batch split (`failure.test.ts`, `lease.test.ts`, `send.test.ts`, `register.test.ts`). The ones that depend on user ID order now use `devices_in_id_order` or sort by user ID. Where the others assert order (`send.test.ts` held batch test: index of `fake:due-at-end`), that order does not depend on user IDs. I did not check this by running the tests
- The storage parts of the range that push does not call (`find_user_by_public_code`, `is_public_code_input`, the public code start fill in `schema.ts`) are outside this target and were not reviewed
