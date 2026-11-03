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

- The range changes no file under `server/core/validation/`. For this module it changes only `core-spec/validation.json` (`settings` is now empty, `usedTables` now has `requirement`), and `tools/data-tool/src/corespec.ts`, which reads `usedTables`. No hunk in the range's changes to other server modules (`coupon`, `matchmaker`, `routing`) changes a call to `validation`. Code outside those places was read for `server/core/validation/*.ts`, but was not checked aspect by aspect against every line of the defining documents, because problems unrelated to the range are not findings of this round.
- Checked by running: `ogw core test server validation` passes. In a temporary copy outside the checkout, a data tool run with `--modules` only `validation` and the `core-spec/` of this range reports nothing on stdout, and its `server/generated/data/game_data.ts` has `RequirementType` (with `None: 0`), `RequirementLogic`, `BannedWordMatch`, `RequirementTable` and `BannedWordTable`, which `server/core/validation/requirement.ts` and `text.ts` read. The server was not started on that generated output.
- Checked by reading only: the removed `supportedLanguages` key does not affect a module input. `server/core/routing/server.ts:297` passes the same `settings` object to every module, `server/core/validation/index.ts` does not read `input.settings`, and the data tool reads `supportedLanguages` from `--game-settings` (`tools/data-tool/src/run.ts:98`). `LocalizationCore`, `auth`, `notice` and `push` still declare the key in `core-spec/`.
- Not checked: the generated field validators and the contract tool that makes them, the implementation of `storage.run_read_only`, and `client/godot/core/requirement_core/` beyond the rules of its spec. Client and server equality rests on the shared fixture `requirement-evaluation`, and only the server side of it ran in this review.
- Which database `ogw core test server validation` used was not checked, so this review does not state a result per database.
