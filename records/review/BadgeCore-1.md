# BadgeCore review round 1

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

- The range changes no file under `client/godot/core/badge_core/`, `core-spec/BadgeCore.json`, `test-data/data/tables/badge.csv` or a `BadgeCore.*` settings value. The changes that were checked for their reach into BadgeCore: `LocalizationCore.list_languages` (BadgeCore calls only `LocalizationCore.format`, client/godot/core/badge_core/badge_core.gd:333), `MessageCore.show_black_box`, `PaymentCore` (a comment), the `QACore` settings read, the generated settings (the three `BadgeCore.*` values are unchanged: 60000, 99, empty string), `godotgen.ts` (float vector arrays; the `badge` table has none), `corespec.ts` (the closure now walks the `requirement` header, whose only ref is to `requirement` itself, so it adds no table to a game with BadgeCore) and `checks/NoticeCore.ts` (reads the `badge` table only; it belongs to NoticeCore). None of them changes a BadgeCore behavior.
- `ogw core test godot BadgeCore` passes on this checkout. Not run: the browser run (`--web`), the core tests of the modules that depend on BadgeCore (`NoticeCore`, `ChatCore`), and the data tool tests. The `corespec.ts` conclusion comes from reading the code and `core-spec/RequirementCore.json`; it was not checked with a data tool run on a game that has BadgeCore. Whether `parseColumnType` and `refsOf` treat the column type `requirement` of `badge` as a ref to `requirement` was not read.
- BadgeCore code and tests were read in full, but the reading for problems that existed before the range was by code reading only: no defect was restored and no scratch test was run. An evaluator that calls `BadgeCore.refresh(<another badge>)` loses that refresh (client/godot/core/badge_core/badge_core.gd:535 resets `evaluate_pending`). It is not written as a problem: the `caller` cell of `refresh` is content code without `hook`, so the core `## spec` rule does not allow that call inside a hook.
- The defining documents were not all read in full. `badge-core.md` and the `client-core` SKILL.md were. `core` SKILL.md, `core` command.md, `godot.md`, `localization-core.md` were searched for the rules that bear on BadgeCore (hook, before `init`, text scale, font). The other dependency specs were not read; their use was checked only against the BadgeCore calls and the passing core tests.
- `records/review-debt/BadgeCore.json` holds D1 and D2 from an earlier BadgeCore review. They are not in input `## debt`, because this round does not pay debt, so no result was decided for them and they are not repeated in `## out of scope`. The code at those places was not changed by the range: `load_saved` still always sets `_save_pending` (client/godot/core/badge_core/badge_core.gd:239) and `_is_decimal` still compares a negative value with the positive limit (client/godot/core/badge_core/badge_core.gd:747).
