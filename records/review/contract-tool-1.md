# review contract-tool round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | tools/contract-tool/src/gen/wire-source.ts:642 | Commit ee58cbae adds the validator rule `nul` (a string field holding U+0000 now fails validation, where it passed before), which changes a rule. Its whole message is the one line `validation: nul rule rejects U+0000 in string fields`. It gives neither the cause it fixes (a NUL string passed the validator and failed the DB statement with `INTERNAL`) nor the evidence (the specification `skills/server-core/modules/validation.md:75`, `skills/contract/tool.md:14`). `## harness writing rules` of AGENTS.md requires both for a commit that changes a rule | Put the cause and the evidence in the message of the commit that brings the `nul` rule (e.g. an amended or follow-up commit that cites the DB failure with `INTERNAL` and `validation.md` `### validator`) | no | 80 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Read the contract-tool changes of the range in full: `tools/contract-tool/src/gen/wire-source.ts` (the `nul` check in `checkText`), the tests added in `tools/contract-tool/tests/roundtrip.test.ts`, and the generated `wire.ts` copies (`server/generated/contract/wire.ts`, `benchmark/godot/server/generated/contract/wire.ts`), which both hold the same check. Checked against `skills/contract/tool.md:14` and `skills/server-core/modules/validation.md:73-77`: decode keeps U+0000 unchanged, the check covers only `string` and not `bytes`, it applies to each element of a `repeated string` field, and `server.ts` `fieldRule` emits a rule for every `string` field, so fields without a declared option are also checked. `tests/roundtrip.test.ts` passes (81 tests)
- Not checked: the order of `utf8` before `nul` inside one field, which the test `utf8 before nul` asserts. The defining documents do not set that order, and no caller relies on it
- Not checked: the regenerated client and server `core_contract` files from commit 7c12b8d5 (base proto changes from other modules), beyond seeing that the contract-tool generator source did not change in that commit. Whether committed generated code matches the generator is the automated check of the generated code
- Not run: the full contract-tool suite and the `validation` module tests (`server/core/validation/tests/*`), which hold the case of a nested message and the `INVALID_REQUEST` request path for `nul`. They are outside the contract-tool target
