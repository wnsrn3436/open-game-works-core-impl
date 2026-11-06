# review PushCore round 1

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

- The commit range de482eec..241d3a3b changes no file under client/godot/core/push_core/ and no PushCore spec, so only the changed code that PushCore or its core tests call was checked. PushCore code (push_core.gd, push_core_node.gd, push_token_wait.gd, push_consent_info.gd, adapters/, dev/) does not call PoolCore, SoundCore, TweenCore, CameraCore, ScreenEffectCore or QACore. client/godot/core/push_core/tests/support/push_test_env.gd inits and releases PoolCore, SoundCore and TweenCore: the range adds DEV skip state to them (PoolCore._effect_skip, SoundCore._dev_mutes and _play_skip, TweenCore._finite_skip) that defaults to off and is cleared in their reset, so it does not reach the PushCore tests. qa_builtins.gd adds set_feedback_off and set_reward_presentation_off and leaves simulate_push unchanged. `ogw core test godot PushCore` on 241d3a3b: pass.
- The PushCore code outside the range was not reviewed, since the commit range is not `none`.
