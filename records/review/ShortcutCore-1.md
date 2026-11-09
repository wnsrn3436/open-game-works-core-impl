# review ShortcutCore round 1

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

- The commit range 625ae189..cc79b3b0 changes no file of `client/godot/core/shortcut_core/` and no ShortcutCore check of the data tool (`tools/data-tool/src/checks/ShortcutCore.ts`, `test-data/data/tables/shortcut.csv` unchanged). The changes that reach ShortcutCore are commit ad967246: `BootstrapCore._shutdown` now calls `release` of every lifecycle module, also a module that is not initialized (`client/godot/core/bootstrap_core/bootstrap_core.gd:1347-1350`), `DataCore.release` of a module that is not initialized resets the test data location (`client/godot/core/data_core/data_core.gd:59-65`), and `UnitTestCore` no longer clears `TimeCore` pre-init values itself. `ShortcutCore.release` of a module that is not initialized returns at once (`client/godot/core/shortcut_core/shortcut_core.gd:29-31`); ShortcutCore has no operation that works before `init` (`register_param_builder`, `navigate` and `is_navigating` refuse before `init`, `shortcut_core.gd:49-51,64-66,90-92`) and the spec has no `## DEV` operation, so it has no pre-init value to delete, which matches the rule of `skills/core/SKILL.md:73`. Checked by reading; no finding
- `ogw core test godot ShortcutCore` ran on this checkout after the range: `ShortcutCore pass`. It wrote no test record because the checkout has an uncommitted change (the deleted earlier `records/review/ShortcutCore-1.md`)
- Code of ShortcutCore outside the range was read (`shortcut_core.gd`, `shortcut_wait.gd`) against the spec stages 1 to 9, `### release` and the error table only to judge whether the range changes reveal a problem; it was not reviewed as a whole target (the commit range is not `none`)
- The server and tool changes of the range (admin-api, iap, item-ledger, storage, session, logging, auth, idempotency, nickname, core settings schema `admin-api.maxSearchRows`) are outside the dependency of ShortcutCore and were not read
