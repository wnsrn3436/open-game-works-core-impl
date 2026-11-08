# update core: LogCore (godot)

## done

- `LogCore` (godot), commit on branch `agent/mw7qmmup44c1bd`. No runtime behaviour change was needed or possible: a Godot 4.7.2 `String` cannot hold U+0000. Reproduced on the pinned engine (4.7.2.stable): `"\u0000"`, `char(0)`, `String.chr(0)`, `"%c" % 0`, `s[i] = "\u0000"`, `get_string_from_utf32`/`get_string_from_wchar`, `bytes_to_var`, `JSON.parse_string("\"a\\u0000b\"")` and `StringName` all give U+FFFD with the engine message `Unexpected NUL character`; `get_string_from_utf8`/`_ascii`/`_utf16`/`uri_decode` end the string at the NUL byte. So every `tag`, `message`, `stack_trace` and `track_event` string value that reaches LogCore already holds U+FFFD in place of each U+0000 that the caller wrote. The existing QACore code (`qa_builtins.gd`) relies on the same fact
  - `client/godot/core/log_core/log_core.gd`: comments of `_escape`, `_enqueue_error` and the string case of `_event_problem` now say how the two new spec lines are met in Godot (no `\0` input, the error queue entry already holds U+FFFD, no U+0000 check because U+FFFD is valid and a check by `char(0)` would match U+FFFD)
  - `tests/test_log_send.gd` `test_an_error_with_u0000_reaches_the_batch_with_u_fffd_in_its_place`: an `error` log whose tag `"t\u0000g"` and message `"\u0000a\u0000b"` hold U+0000 is in the next `LogBatch` with U+FFFD in those places and the same code point counts (3, 4); its log line is one line of 5 fields
  - `tests/test_log_analytics.gd` `test_a_string_value_written_with_u0000_is_put_in_with_u_fffd`: a string value written with U+0000 reaches LogCore as U+FFFD, `track_event` returns `true`, gives no `error` log, and the batch holds `"a�b"`. Checked that the test runs by making its expected value wrong (it failed)
- Tests: `ogw core test godot LogCore` pass, `ogw core test godot LogCore --web` pass; the 43 modules of `ogw core dependents LogCore` (all client) pass with `godot` and then with `godot --web`. `ogw code check core`: type check, lint, dependency, secret pass
- No caller of another module was changed. No engine-specific implementation rules document and no `## <engine> build` of `tools/ogw.md` were written

## spec proposals

- `## test` of `log-core.md`, item `An error log whose tag and message hold U+0000 ...`: in the Godot client the parts `its log line holds \0 in those places` and `track_event with a string value that holds U+0000 returns false ... and gives one error log` have no input, because the engine replaces U+0000 with U+FFFD when it makes a `String` (evidence above), so LogCore never sees U+0000. Proposal: add to `skills/client-core/engines/godot.md` an engine-specific row, e.g. "`LogCore` | U+0000 | A `String` cannot hold U+0000: the engine puts U+FFFD in its place where it makes the string. The `\0` escape of the log line and the U+0000 check of `track_event` have no input, and the U+0000 item of `## test` is checked as: a tag and message written with U+0000 are in the `LogBatch` and the log line with U+FFFD in those places and the same code point counts, and `track_event` with such a string value returns `true`". The current tests already check that form

## review

none

## unverified

- The log line `\0` escape and the `track_event` rejection of a U+0000 string value (the remaining parts of the `## test` item) cannot be checked in Godot: no GDScript value can carry U+0000 into LogCore (see `## done`). A GDExtension that builds a `String` from raw `char32_t` with length was not tried; the engine's own constructors checked here all replace or cut U+0000
