# review: shop round 1

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

- Commit range 2ef5ae8d3d40c74ba1bc3385efee1c2c0591c772..806fccabef9d839da5a2843640d3683d784fa41c changes no file under `server/core/shop/`. In the dependency modules the range changes only `server/core/storage/` (`create_user` now returns `NewUser`, `get_user_record` adds `public_code`, new `find_user_by_public_code` / `is_public_code_input`, schema version bump) and test helpers of item-ledger, mailbox, logging and validation. `grep` shows that `server/core/shop/` does not call `create_user`, `get_user_record` or `public_code`, and the storage operations shop calls (`get_state`, `put_core_state`, `with_hook_change_source`, `check_hook_output`) are not in the storage diff. So no change in the range reaches shop code or shop tests.
- Not checked, because the usage limit ended the review early: whether the storage schema changes (`server/core/storage/schema.ts`, `core-schema-version`) change how shop core state rows are stored; whether the changed test helpers of item-ledger, mailbox, logging and validation are used by `server/core/shop/tests/helpers.ts`; and running the shop tests on the range end commit. The defining documents (shop spec and dependency specs) were not re-read against the code, because the range does not change shop and `## spec changes` is `none`.
