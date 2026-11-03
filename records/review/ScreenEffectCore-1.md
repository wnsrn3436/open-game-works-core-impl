# review ScreenEffectCore round 1

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

- The range 9b1e14b5..4fdd5bc9 changes no file under client/godot/core/screen_effect_core/ and no file of its dependency modules (LogCore, EventCore, TweenCore, ResolutionCore, UICore), and core-spec/ScreenEffectCore.json is unchanged. The client changes of the range were read: bootstrap_core tests, localization_core (`list_languages` parameter type), message_core (`show_black_box` signature), payment_core (a comment), qa_core (settings reads removed) and generated settings. None of them calls ScreenEffectCore, and `TweenCore.maxDurationMs`, the only setting the module reads, is unchanged at client/godot/generated/core_settings.json:327
- `ogw core test godot ScreenEffectCore` reported `pass`. The output does not say whether the module ran again or a kept passing result was used. Tests of the modules that depend on ScreenEffectCore (CutsceneCore, SceneCore, AccessibilityCore and others) were not run
- records/review-debt/ScreenEffectCore.json holds D1, D2 and D3. This round's input `## debt` is `none`, because a review with a commit range does not pay debt, so these items were not judged and stay in the list. Reading client/godot/core/screen_effect_core/screen_effect_core.gd and tests/ shows their positions unchanged. They were not reproduced in this round
- Not checked: the case in which code resumed by `wait_result` calls `ScreenEffectCore.release` directly while `_on_frame` or `clear_owner` loops over `_current` (client/godot/core/screen_effect_core/screen_effect_core.gd:237, :216). `release` empties `_current`, so the next iteration would read an index that is not there. The restart path does not reach this, because `BootstrapCore._run_restart` waits for the next frame before release (client/godot/core/bootstrap_core/bootstrap_core.gd:1157). The other shutdown paths of BootstrapCore (`_request_quit`, `_shutdown`) were not traced, and the case was not run, so it is not written as a problem
- The Web run (`ogw core test godot --web`) was not run
