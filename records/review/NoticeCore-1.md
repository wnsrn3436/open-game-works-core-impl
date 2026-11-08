# review NoticeCore round 1

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

- The commit range changes no file of `client/godot/core/notice_core/`, no `Notice`, `NoticeKind`, `GetNoticesRequest` or `GetNoticesResponse` definition of `proto/ogw/core.proto` and no file of server core `notice`. The changes of the range that NoticeCore calls are `client/godot/core/time_core/time_core.gd` (frame step, `make_random_seed`) and `client/godot/core/log_core/log_core.gd` (comments only). NoticeCore reads `TimeCore.get_real_time` for the cache TTL (`client/godot/core/notice_core/notice_core.gd:355`, `:391`), the image time limit (`:263`, `:468`) and the maintenance retry delay (`:636`); at a frame step these follow the real elapsed time of TimeCore, which is what `notice-core.md` sets (real elapsed time of `TimeCore`). It does not call `make_random_seed` or the changed LogCore code paths. The NoticeCore code that the range does not reach was not reviewed again
- `ogw core test godot NoticeCore` passed. No test was run with the engine started at a fixed frame rate (`--fixed-fps` or Movie Maker), so the image time limit and maintenance retry delay at a frame step were checked only by reading the code
- The `NetworkCore`, `UICore`, `BadgeCore`, `LocalDataCore`, `LocalizationCore` and `EventCore` code that NoticeCore calls is unchanged in the range and was not reviewed
