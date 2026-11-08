# update core: validation (nul rule)

## done

- validation (server): the `nul` rule. A `string` field holding U+0000 (top-level, in a message inside a message, or as an element of a `repeated string` field) fails with rule `nul`, checked right after `utf8`. The check is in the field validation runtime that the contract tool writes (`tools/contract-tool/src/gen/wire-source.ts` `checkText`), which the generated validators that `validate_request` / `validate_message` run use. Decode keeps U+0000 unchanged and does not fail (`skills/contract/tool.md`)
- contract-tool: the same `wire-source.ts` change. The generated copies `server/generated/contract/wire.ts` (rewritten by `ogw core test`) and `benchmark/godot/server/generated/contract/wire.ts` (copied, since it was byte-identical to the former before the change) are committed with it
- Tests added
  - `server/core/validation/tests/validator.test.ts`: `nul` at the top level (also from bytes decoded off the wire), in a message inside a message (`errors[1].message`), and in an element of a `repeated string` field plus a nested string of a game rpc, through `create_validation(...).validate_request`. That last one uses a game contract generated in a temporary folder, because neither the base proto nor the core test contract has a `repeated string` request field
  - `server/core/validation/tests/request.test.ts`: `SetNickname` and `ReportClientErrors` with U+0000 come back as `INVALID_REQUEST` with detail `<path>: nul`. The handler is not called and the saved state does not change
  - `tools/contract-tool/tests/roundtrip.test.ts`: U+0000 decodes as it is, encodes back to the same bytes and fails `nul`; `nul` on a field and on a `repeated string` element; `utf8` wins over `nul` when a string has both problems
- Caller of another module that had to follow (guild): `server/core/guild/tests/query.test.ts` asserted that `SearchGuilds` with U+0000 in `name` returns code 0 and an empty list. The validator now rejects that request first, so the test expects `INVALID_REQUEST` and still checks that no error log is written. The current guild spec has no `## test` item for the old behaviour. Guild code is not changed: the `prefix.includes('\u0000')` guard in `server/core/guild/rpc.ts:186` is now unreachable through the rpc and was left as it is
- `server/generated/core_settings_schema.json` was untracked after `ogw core spec` / `ogw core test` wrote it. It is committed as a generated file so that the test record could be kept
- No engine-specific implementation rules document or `## <engine> build` section was written
- Last runs: `ogw core test server validation` pass; `ogw core test server <all 24 server dependents + validation>` all pass; `ogw core test tools contract-tool` pass; `ogw code check core` type check, lint, dependency and secret pass

## spec proposals

none

## review

none

## unverified

- The first dependents run had `testing` fail on PostgreSQL only: `isolation.test.ts` "a test server that fails during restart_test_server leaves no temporary folder or open port" hit `wait_background did not end within 10000 ms`. That ran while 24 server modules and the tools target ran at once. The test has no string input, and the next run of the same module list (code unchanged for `testing`) passed. The cause was not reproduced, so this is recorded as a likely load-dependent timeout that has not been investigated
- Client dependents (`ogw core dependents` lists 13 client modules) were not run, because no client code changed
