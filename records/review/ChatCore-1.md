# review ChatCore round 1

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

- The commit range de482eec..9069447b changes no file under `client/godot/core/chat_core/` and none of the modules in `## dependency` of the ChatCore spec (LogCore, EventCore, TimeCore, LocalDataCore, NetworkCore, BadgeCore), nor the server `chat` module. The changed code (CameraCore, PoolCore, QACore, ScreenEffectCore, SoundCore, TweenCore, and the new `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs` core settings keys) is not called by ChatCore code; ChatCore code was not reviewed beyond confirming that, because no change of the range reaches it
- PoolCore, SoundCore and TweenCore are only initialized by the ChatCore test support (`client/godot/core/chat_core/tests/support/chat_test_case.gd:89`, `:94`, `:97`) to build the NetworkCore stack. `ogw core test godot ChatCore` and `ogw core test godot ChatCore --web` on 9069447b both pass
- `records/1793983617747-update-core-mw57iymre530bb.md` notes ChatCore core tests failing with `test time limit 30000 ms passed` and init-order errors when a godot run and a `--web` run ran at the same time. That was not reproduced here: the two runs above ran one after the other, so whether ChatCore tests fail under concurrent runs was not checked
