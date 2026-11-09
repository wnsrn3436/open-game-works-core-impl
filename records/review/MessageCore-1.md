# review MessageCore round 1

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

- The commit range 625ae189..66fa6ab3 changes no file of `client/godot/core/message_core/`. The client changes in the range that reach MessageCore were checked: `client/godot/core/bootstrap_core/bootstrap_core.gd:1350` now calls `release` of every lifecycle module in `shutdown`, also of a module that is not initialized. `client/godot/core/message_core/message_core.gd:79` returns at once when not initialized; MessageCore has no operation called before `init` and no DEV operation, so it has no value to delete then, which is what `open-game-works-core/skills/core/SKILL.md:73` requires. The removal of `_clear_pre_init_values` in `client/godot/core/unit_test_core/dev/unit_test_core.gd` touches only `TimeCore`, which MessageCore reads only through `get_real_time` after `init`
- No module MessageCore depends on (`LogCore`, `TimeCore`, `ResourceCore`, `PoolCore`, `LocalizationCore`, `ResolutionCore`, `InputBlockCore`, `TweenCore`, `UICore`) changed in the range, so the calls from MessageCore into them were not reread for new behavior
- `ogw core test godot MessageCore` (job mw8mg1q1cd5dc8) passed on this checkout. The whole client test suite was not run
- MessageCore code outside the range was read (`message_core.gd`, `message_kind_state.gd`, `message_core_node.gd`, `message_view.gd`) but was not audited against every line of the spec, since problems from before the range are only out-of-scope items. Nothing at `medium` or above was found in what was read
