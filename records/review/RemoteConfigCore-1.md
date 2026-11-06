# review RemoteConfigCore round 1

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

- The commit range de482eec..f7747731 changes no file under `client/godot/core/remote_config_core/` and no code of the modules it depends on (LogCore, EventCore, TimeCore, DataCore, NetworkCore, AuthCore). The changed files are QACore, PoolCore, SoundCore, TweenCore, CameraCore, ScreenEffectCore, records and the core settings keys `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs`. RemoteConfigCore reads only its own setting (`client/godot/core/remote_config_core/remote_config_core.gd:45`), so the new keys do not reach it. The code of RemoteConfigCore outside this range was not reviewed, because a review with a commit range reviews only problems that the range causes or reveals.
- `records/1793983622704-update-core-mw57j2gg23e425.md:22` records 30 s test timeouts of RemoteConfigCore in a run at host load average about 159 that passed when repeated alone. The cause was not reproduced in this review, and the RemoteConfigCore tests were not run, because the range changes no code they exercise.
