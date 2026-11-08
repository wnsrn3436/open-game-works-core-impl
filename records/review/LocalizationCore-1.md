# review: LocalizationCore round 1

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

- The commit range 85f6b36d1d30dbf063ec79d2ecf8fffb67eace97..e0d97f06c8ed246f01e4cc22f511f81dc899916a changes no file under `client/godot/core/localization_core/` and no `LocalizationCore.*` key of `settings/core-settings.json`, `client/godot/generated/core_settings.json` or `client/godot/generated/core_settings_types.json`; input `## spec changes` is `none`. Checked: the dependency changes of the range that reach LocalizationCore. `client/godot/core/input_core/input_core.gd` now publishes `InputPromptChangedEvent` on `set_pad_axis_inverted`, on reset of the stick axis options and at init when an inversion is applied, and `get_prompt` gives the other direction for an inverted axis of a `Gameplay` action. LocalizationCore subscribes to that event and rewrites bound elements with the `get_text` result (`client/godot/core/localization_core/localization_core.gd:105`, `localization_core_node.gd`), which is what `localization-core.md` sets; the init event comes before LocalizationCore `init` (InputCore is a dependency), and bindings are written on `bind_text` anyway. `client/godot/core/log_core/log_core.gd` changed only comments. The new callers in the range (`accessibility_core.gd` `set_text_scale` on reset, `qa_core/dev/qa_query.gd` `is_initialized` and `get_language_code`) use operations that are in the spec or in the Godot lifecycle rules (`engines/godot.md:270`)
- `ogw core test godot LocalizationCore` (job mw7uh5195ebf4f) passed for the native run and the browser run on this checkout
- No finding was written for the code of LocalizationCore that the range does not change, because it is outside the scope of a review with a commit range. It was read only where the dependency changes above reach it (`init`, `get_text`/`format` prompt token replacement, `_rewrite_bindings`, `set_text_scale`)
