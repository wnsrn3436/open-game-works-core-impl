# BadgeCore review round 1

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

- The commit range `47b588d..bcdb386` changes no BadgeCore code or test. `git diff --stat` touches only `client/godot/core/requirement_core/`, `client/godot/core/qa_core/`, `client/godot/core/bootstrap_core/` and the run records. The RequirementCore change swaps the owner watch counter `_owner_watch_count` for the slot list `_owner_slots` (`client/godot/core/requirement_core/requirement_core.gd:55`, `:501`, `:518`, `:627`, `:750`). Checked where BadgeCore reaches RequirementCore: `client/godot/core/badge_core/badge_core.gd:473` calls only `RequirementCore.evaluate`. `evaluate` (`client/godot/core/requirement_core/requirement_core.gd:151`) reads no watch state. BadgeCore and its tests call neither `RequirementCore.watch` nor `RequirementCore.unwatch`, and they don't refer to `_owner_watch_count` or `_owner_slots`. So with no owner watch, the RequirementCore frame code loops over an empty `_owner_slots` and changes nothing that BadgeCore reads. QACore and BootstrapCore are not BadgeCore dependencies, and BadgeCore does not call them
- The BadgeCore core tests were not run in this review. The run needs the GUT setup, the test host and the core fixtures that `ogw core test` prepares, so whether they pass on `bcdb386` is not checked here
