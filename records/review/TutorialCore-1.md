# review TutorialCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/tutorial_core/tutorial_core.gd:680: medium `_update_start_watch` has this one caller, in `_complete`, so a start watch is taken off only when a tutorial ends in this run. `open-game-works-core/skills/client-core/modules/tutorial-core.md:64` calls `RequirementCore.unwatch` when all tutorials with that `start_requirement` are completed, and line 42 defines completed by the progress step, which a `TutorialProgressUserState` delta also raises. Run path: after the first start check of a login sets the start watch of a tutorial that is not active, DEV `set_tutorial_step` (`server/core/tutorial/index.ts:79`) sends a delta with its last `step`. `_on_user_state_changed` only runs the start check, `_is_complete` is now `true`, and the watch stays until `release`, running start checks that cannot start that tutorial. A build without DEV code has no such writer: the only other write is this client's own `SaveTutorialProgress`, queued by `_save` before `_complete`, so `_complete` has already taken the watch off when its delta arrives. `test_watch.gd` `test_the_start_watch_is_taken_off_when_every_tutorial_with_its_start_requirement_is_finished` covers only the end through `_complete`. Checked by reading; this was not run. The code is outside the commit range

## debt

none

## must fix

none

## unknown

- The commit range changes no file of `client/godot/core/tutorial_core/`, `server/core/tutorial/`, `core-spec/TutorialCore.json`, `core-spec/tutorial.json` or `tools/data-tool/`, and no client module in `## dependency` of `tutorial-core.md`. So no finding comes from a change in the target
- Indirect path: by the `dependencies` and `optionalDependencies` of `core-spec/`, the closure of TutorialCore has `AuthCore`, then server `auth`, then its optional dependencies `block-report` and `iap`. `server/core/auth/deps.ts` changed the `block-report` `remove_user` type to `FallibleRemoveUser`, `block-report` changed `remove_user` and `add_report`, and `iap` changed its grant rules and Google adapter. These change withdrawal, reports and payments on the server. TutorialCore reads only `AuthCore.is_logged_in` from `AuthCore`, no file of `client/godot/core/auth_core/` changed, and a search of `server/core/auth/` for `tutorial` finds nothing. `RealtimeCore` and `routing`, the other modules changed in the range, are not in the closure. Why the tool chose TutorialCore as a target was not checked in `ogw core review-targets`; this path is inferred from `core-spec/`
- `settings/core-settings.schema.json`: the minimums changed in the range do not include `TutorialCore.anchorWaitWarnMs` or `RequirementCore.timeRecheckMs`, which stay at minimum 0
- Tests were not run. Godot core tests of TutorialCore and of the modules it depends on were neither run nor needed for a finding, so nothing here says that they pass
- `client/godot/core/tutorial_core/tutorial_core.gd` and `tutorial_core_node.gd` were read in full against `tutorial-core.md`, but only as a check of the range, not as a whole-target review. `tutorial_view.gd`, `tutorial_run.gd`, `tutorial_def.gd`, the tests other than `test_watch.gd`, `server/core/tutorial/` and the rest of `tools/data-tool/src/checks/TutorialCore.ts` (after its first 70 lines) were not checked line by line. `open-game-works-core/tools/src/commands/check/static/anchor-reference.ts` was only searched for its `gamepadSupported` branch
- The 8 items of `records/review-debt/TutorialCore.json` are not in input `## debt`, because this review does not put the debt list in its scope. They were not judged again
- Definition documents other than `tutorial-core.md` and `server-core/modules/tutorial.md` were read only where the check needed them: `auth-core.md`, `user-state-core.md`, `godot.md`, `core/command.md`. The other module specs were not read, as input `## spec changes` is `none`
