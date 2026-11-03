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

- `client/godot/core/localization_core/text_format.gd`, `translation_binary.gd`, `format_args.gd`, `downloaded_translation.gd`, `localization_core_node.gd` and the tests other than `test_language.gd` and `test_lifecycle.gd` were not read: the range does not change them, and `list_languages`, the only LocalizationCore code the range changes, neither calls them nor is called by them. `localization_core.gd` was read in full, but only `list_languages` was checked against every aspect, so the absence of out of scope problems holds only for what that reading showed.
- Only `tests/test_language.gd` and `tests/test_lifecycle.gd` were run (`ogw core test godot LocalizationCore --file`, both pass on Godot 4.7.2). The other LocalizationCore test files, the core tests of modules that depend on LocalizationCore, and the browser run (`--web`) were not run. No module in `client/godot/` calls `list_languages` outside these two test files.
- The defect of a buffer that does not reach the caller was not restored in the core test. It was checked only with a separate script on the pinned Godot 4.7.2: a write to a `PackedInt32Array` argument reaches the caller's array, a write to a `duplicate()` of it does not, and the int32 maximum 2147483647 is stored unchanged. Whether `test_list_languages_fills_the_buffer_in_order_order` fails on that defect is judged from reading its asserts, which compare the filled buffers with the expected ID values.
- The other files changed in the range (server core, data tool, `MessageCore`, `QACore`, `PaymentCore`, `BootstrapCore`) belong to other review targets. Of these, only the diffs of `tools/data-tool/src/godotgen.ts` and of settings were read, and they do not change the `language` table, the generated `LanguageRow` or a `LocalizationCore` settings key.
- `records/review-debt/spec-LocalizationCore.json` (added in the range) holds items D1 to D4 of the spec review list. They are not in input `## debt`, so no result was decided for them.
