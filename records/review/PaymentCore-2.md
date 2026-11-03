# review: PaymentCore round 2

## findings

none

## previous

none. Round 1 had no findings

## out of scope

none

## debt

none

## must fix

| id | result | finding | evidence |
|---|---|---|---|
| M1 | withdrawn | none | The plugins are still absent, and that absence is now the defined state, so it is not a defect of the target. `open-game-works-core/skills/client-core/engines/godot.md:55` (harness commit `39e0992`, made after round 1) says `ogw-native-ui` and `ogw-secure-storage` are built, each other `ogw-` plugin is written in the `update core` that a human orders for that plugin, and until then an STG or PROD build that needs it fails check `native plugin`. No such order is recorded: `records/` names `ogw-iap-` only in `review/PaymentCore-1.md` and `review-must-fix/PaymentCore.json`. The code follows that definition. `git ls-files client/godot/plugins` still has only those two, `plugins` of `client/godot/engine.json` lists neither `ogw-iap-apple` nor `ogw-iap-google`, and `client-godot-plugins.zip` of 0.6.0 holds neither. `open-game-works-core/tools/src/commands/build/lib/native-plugins.ts:28` and `:29` make those two needed in STG and PROD when the adapter value is not `fake`, on the platforms of the `godot.md` table. A DEV build is not checked, and it fails without a crash: `tests/test_adapter.gd:6` passes with `prepare` `false` and one error log, and `purchase` returns `STORE_FAILED` at `client/godot/core/payment_core/payment_core.gd:402`. The result is `withdrawn` and not `fixed` because nothing was built and no file of the target changed. |

## unknown

- No real store purchase can run yet. Withdrawing M1 removes it from the must-fix list, so nothing in the review lists tracks this any more. `open-game-works-core/skills/client-core/engines/godot.md:55` leaves it to a human to order the `update core` for `ogw-iap-apple` and `ogw-iap-google`.
- Input `## spec changes` is `none`, although harness commit `39e0992` changed `open-game-works-core/skills/client-core/engines/godot.md`, a defining document of this target. That change was read, and M1 is judged against it. Why the input does not list it was not checked.
- The range `6d11fa6..474d76d` changes only files under `records/`, and none of them is code or a test. No code of the target was reviewed anew, so this round finds no problem that the range causes or reveals. The code read was limited to `adapters/plugin_store_adapter.gd`, the `prepare` and `purchase` paths of `payment_core.gd`, and `tests/test_adapter.gd`.
- Only `tests/test_adapter.gd` was run, with `ogw core test godot PaymentCore --file`, natively. It passes. That run leaves no test record. The other PaymentCore test files, `--web` and the tests of dependent modules were not run.
- D1 to D6 of `records/review-debt/PaymentCore.json` are not in the input `## debt` of this round, so they were not checked again. They stay in the debt list.
- The `native plugin` check was read in `native-plugins.ts` and not run in a build. No STG or PROD build was started, and the `ogw-iap-` native code does not exist, so nothing behind `client/godot/core/payment_core/adapters/plugin_store_adapter.gd` was checked. No real store SDK was run.
