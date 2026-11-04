# NativeUiCore review fix round 3

## done

- No code or test change, and no commit. `records/review/NativeUiCore-3.md` has no row in `## findings`, `## previous`, `## debt` or `## must fix`
- Code check: type check, lint, dependency and secret `pass`. `fix test proof` is `fail` against `f8ed28b`, the same `--fix-base` as round 2. This is the second `fail` of that fix base. `tools/ogw.md` `## review run` says a second `fail` of the same `--fix-base` stays in the code check result and the fix base is not given again
  - Why no test can fail on `f8ed28b`: the proof was added for R1-4 (aspect `spec`, `spec change` `no`). R1-1, R1-2 and R1-3 are `test evidence`, and R1-5 is `spec change` `yes`. R1-4 only made `client/godot/core/native_ui_core/dev/native_ui_core_dev.gd` read the fake adapter through a `preload()` constant (`_FAKE`) and not through `FakeNativeUiAdapter`, following `open-game-works-core/skills/client-core/engines/godot.md:433`. The failure that rule prevents (`resources still in use at exit` in the type check) needs a file that names the base adapter type. At `f8ed28b` the DEV file never names `NativeUiAdapter`, and the round 1 type check of that code was `pass` (`round-1-code-check.json`). So the old code already worked, and no runtime behavior changed
  - No code under `client/godot/core/native_ui_core/`, `client/godot/plugins/ogw-native-ui/` or the modules NativeUiCore depends on changed from `6692a13` to HEAD `4288a46` (checked with `git log`). So the round 2 reasoning still holds
  - I did not add a test that reads the source text for the global name. It would be an approximate check of a coding rule
- I did not write an engine-specific implementation rules document. I did not write `## <engine> build` of `tools/ogw.md`

## spec proposals

none

## review

- `records/review/NativeUiCore-3.md` has no finding id, so there is nothing to fix or dispute
- `fix test proof` `fail`: not fixed. See `## done`. R1-4 changed no behavior, so no test can fail on `f8ed28b`

## unverified

- I did not run `ogw core test` or `ogw code check core` again. No NativeUiCore code changed since the round 3 code check
- I did not reproduce the `resources still in use at exit` failure of the pinned Godot with a file that names `NativeUiAdapter` and reads `FakeNativeUiAdapter` members by global name. The claim that `f8ed28b` does not meet the failure condition comes from reading the file and from the round 1 type check `pass`
- The places in `## unknown` of `records/review/NativeUiCore-2.md` are still unchecked: the native render pass, an Android device run of `request_review`, and the iOS and macOS plugin source `ogw_native_ui.mm`
