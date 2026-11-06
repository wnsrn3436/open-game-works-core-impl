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

- The commit range de482eec..e4aee06c changes no file of `client/godot/core/notice_core/` and no file of the modules in `## dependency` of the NoticeCore spec (LogCore, EventCore, TimeCore, LocalDataCore, LocalizationCore, NetworkCore, UICore, BadgeCore). The changed code is CameraCore, PoolCore (DEV effect skip), QACore, ScreenEffectCore, SoundCore (DEV mute and play skip), TweenCore (DEV finite skip) and the settings `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs`. The new PoolCore, SoundCore and TweenCore flags are `false` by default, are reset in their `release`, and are set only through their DEV operations, which NoticeCore and its tests do not call. NoticeCore code does not reference any of the changed modules, so no change of the range causes or reveals a NoticeCore problem. The NoticeCore test support (`tests/support/notice_test_case.gd`) only calls `init` and `release` of SoundCore, TweenCore and PoolCore
- `notice_core.gd`, `notice_core_node.gd`, `notice_waiter.gd`, `image_downloader.gd`, `http_image_downloader.gd`, `web_image_downloader.gd`, `dev/notice_core_dev.gd` and the test function list of `tests/` were read and compared with the spec to look for out-of-scope problems; none of severity `medium` or above was found with confidence 80 or more
- Two `wait_maintenance_clear` calls running at the same time share `_popup_waiter` and `_retry_waiter` (`client/godot/core/notice_core/notice_core.gd:603`, `notice_core.gd:627`), so the first call could keep waiting after its popup closes. This is not written in `## out of scope`: the spec names only `BootstrapCore` (`Login` stage) as the caller, and its only call (`client/godot/core/bootstrap_core/bootstrap_core.gd:567`) runs once per boot, so no supported run path reaches it
- `web_image_downloader.gd` was read but not run. It runs only in a Web export, and this review did not run one
- The NoticeCore core tests were not run. No finding needed checking, and the range changed no file of the target
