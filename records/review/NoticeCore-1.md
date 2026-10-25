# NoticeCore review round 1

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

- The commit range `47b588d..bcdb386` changes no NoticeCore file (`client/godot/core/notice_core/`, `core-spec/NoticeCore.json`) and no generated file or core spec. It changes only `BootstrapCore` (the fatal screen label draws with `ThemeDB.fallback_font`, `client/godot/core/bootstrap_core/bootstrap_core.gd:1125`), `QACore` DEV code (`step` fails with `game time is paused`, `client/godot/core/qa_core/dev/qa_builtins.gd:767`), `RequirementCore` (the owner watch count replaced by the owner slot list, `client/godot/core/requirement_core/requirement_core.gd:55`), their tests, and run records of other agents
- Checked how the changes reach NoticeCore: NoticeCore does not call `BootstrapCore`, `QACore`, `TimeCoreDev` or `TimeCore.set_paused` (no reference in `client/godot/core/notice_core/`); `BootstrapCore` calls `NoticeCore.wait_maintenance_clear` (`client/godot/core/bootstrap_core/bootstrap_core.gd:544`), which the range does not change, and the font override touches only the fatal screen label, not the maintenance system popup that NoticeCore opens with `UICore.open_system_popup` (`client/godot/core/notice_core/notice_core.gd:604`); NoticeCore reaches `RequirementCore` only through `BadgeCore`, which calls only `RequirementCore.evaluate` (`client/godot/core/badge_core/badge_core.gd:473`), not `watch`, so the changed owner watch code is not run on the NoticeCore path; the NoticeCore test support only calls `RequirementCore.init` and `RequirementCore.release` (`client/godot/core/notice_core/tests/support/notice_test_case.gd:246`, `:269`), and `_reset` still empties the new owner slot list
- The NoticeCore core tests were not run in this review (no Godot run was made); the conclusion above comes from reading the code
- NoticeCore code outside the range (`notice_core.gd`, `notice_core_node.gd`, the image downloaders, `notice_waiter.gd`, `dev/`, the tests) was read only to find its calls into the changed modules; it was not checked for problems that existed before the range
