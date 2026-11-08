# review LogCore round 1

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

- Scope: in the commit range `85f6b36d..0806d79e`, LogCore changed only in commit `2dcf8a46`. That commit adds comments to `client/godot/core/log_core/log_core.gd` (`_escape`, `_event_problem`, `_enqueue_error`; no code changed) and adds two tests: `test_an_error_with_u0000_reaches_the_batch_with_u_fffd_in_its_place` (`tests/test_log_send.gd`) and `test_a_string_value_written_with_u0000_is_put_in_with_u_fffd` (`tests/test_log_analytics.gd`). Both follow the LogCore U+0000 row of the Godot implementation rules (`open-game-works-core/skills/client-core/engines/godot.md:347`): no input holds U+0000, the `## test` items use a `String` written with U+0000 whose U+FFFD reaches the `LogBatch` and is taken by `track_event`, and the `\0` escape and the `track_event` rejection have no input in Godot
- I checked that claim on the pinned Godot 4.7.2.stable (`client/godot/engine.json`) with a headless script. A `String` made by a `"\u0000"` literal, `char(0)`, `String.chr(0)`, concatenation, `PackedByteArray.get_string_from_utf32()` and `JSON.parse_string("\"a\\u0000b\"")` holds U+FFFD (65533) in place of U+0000 and keeps the same length. `get_string_from_utf8()` and `get_string_from_ascii()` stop at the NUL. None of these paths gives a `String` that holds U+0000, so `_escape` without `\0` and `_event_problem` without a U+0000 check cannot be reached by an input that differs from the spec
- Tests run: `ogw core test godot LogCore --file` for `tests/test_log_send.gd` and `tests/test_log_analytics.gd`. Both pass. Not run: the rest of the LogCore test files and the browser run (`--web`), because the range did not change the code they test
- Not checked: LogCore code that the commit range did not change was not audited as a whole. I looked only at the functions that carry the new comments and the code around them (`_format_line`, `_escape`, `_event_problem`, `_enqueue_error`), so I report no out-of-scope problems for the rest of the module
