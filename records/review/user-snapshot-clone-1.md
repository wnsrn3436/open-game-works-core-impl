# review user-snapshot-clone round 1

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

- Only one file of `server/core/user-snapshot-clone/` changed in the range: `tests/clone.test.ts:166-169`, where the sweep failure test now orders its two clones by `target_user_id` instead of by creation order. I read this change against `EXPIRED_CLONES ... ORDER BY target_user_id` (`server/core/user-snapshot-clone/index.ts:142`) and against the sweep loop (`server/core/user-snapshot-clone/index.ts:289-306`). The test still fails the clone that the sweep reaches first and checks that the sweep goes on to the next one. No finding.
- I checked the parts of the range that this module calls or reads. `storage.get_user_record` now also returns `public_code`; the module reads only `created_at` (`server/core/user-snapshot-clone/index.ts:355-356`). `storage.create_user` now returns `NewUser`; the module does not call it. User IDs are now random and below 2^53; the clone record, `list_clones` and the sweep order by `target_user_id` and handle IDs as bigint or decimal string. The one table the range added, the public-profile find counter (`server/core/public-profile/index.ts`), is registered with snapshot flag `false`. That matches the `### included rows` rule that excludes attempt counters, so `read_user_rows` and `replace_user_rows` do not touch it. `public_code` is a column of the `user` row and is not a raw row, so a snapshot neither holds it nor replaces it. No defining document asks for that.
- Code outside the range was read only where the changed code reaches it. The commit range is not `none`, so the whole module was not reviewed again.
- Tests were not run (`ogw core test` was not called). A review writes no files outside `output`, and `ogw core spec` would regenerate files in the checkout. This review does not record whether the changed `clone.test.ts` passes.
