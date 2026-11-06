# review RealtimeCore round 1

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

- The commit range de482eec..bda79045 changes no file under `client/godot/core/realtime_core/` and no file of the modules it depends on (UtilCore, LogCore, EventCore, TimeCore, LocalDataCore, DataCore, AuthCore, NetworkCore) or of the server modules Matchmaker and P2PSignaling. The client core changes of the range are in CameraCore, PoolCore, QACore, ScreenEffectCore, SoundCore and TweenCore, and the settings changes add only the keys `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs`
- Code that RealtimeCore calls, or that calls RealtimeCore, in the range: the QACore callers of RealtimeCore (`client/godot/core/qa_core/dev/qa_builtins.gd` `leave_match`, `drop_peer`, `step`, `force_matchmaker_lost`, and `client/godot/core/qa_core/dev/qa_query.gd` match state and room) have no changed lines in the range. The `_on_frame_start` signature change of QACore is not referenced from `client/godot/core/realtime_core/`. No finding comes from the range
- The RealtimeCore core tests (`ogw core test godot RealtimeCore`) were not run in this review: no finding needed checking, and a run writes generated files into the checkout, which this review does not edit
- Problems in RealtimeCore code that existed before the range and are unrelated to its changes were not looked for, because the commit range is not `none`
