# review: validation round 1

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

- The commit range changes 321 files; validation is touched only by commit ee58cbae (the `nul` rule in `checkText` of `tools/contract-tool/src/gen/wire-source.ts`, its generated copies `server/generated/contract/wire.ts` and `benchmark/godot/server/generated/contract/wire.ts`, and tests in `server/core/validation/tests/` and `tools/contract-tool/tests/roundtrip.test.ts`) and commit 54c065a2 (a test guard). Changes to `storage` (DB meter, `make_seed`, seed provider signature) and `routing` in the range were read only as far as the validation module calls them (`storage.run_read_only` in `server/core/validation/index.ts:99`); they do not change that path. Other changes of the range belong to other modules and were not reviewed here
- `server/generated/core_settings_schema.json`, added in commit ee58cbae, is a generated file of `ogw core spec` (`## core spec and core test` of ogw); its content was not checked
- Checked: every `string` field gets a rule (`fieldRule` in `tools/contract-tool/src/gen/server.ts:173` keeps rules of kind `string`), so the `nul` check runs for fields without `(ogw.v)` options, for `repeated string` elements (`checkList` → `checkValue`), and in messages inside messages; the same `Wire.validate` serves `validate_request`, `validate_message` and the DEV cheat validators. `ogw core test server validation` passed. The tools tests (`tools/contract-tool/tests/roundtrip.test.ts`) were not run
