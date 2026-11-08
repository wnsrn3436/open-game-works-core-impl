# ChatCore review round 1

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

- The commit range 85f6b36d..9808fd47 changes no file under `client/godot/core/chat_core/`, no ChatCore spec (`core-spec/ChatCore.json` unchanged, input `## spec changes` is `none`) and no server `chat` module or `tools/data-tool/src/checks/ChatCore.ts`. The review checked the changes of that range that ChatCore calls: `TimeCore.get_real_time` (`client/godot/core/time_core/time_core.gd:324`; the new DEV frame step at `client/godot/core/time_core/time_core.gd:421` only changes the real increment per engine frame, which ChatCore polling reads at `client/godot/core/chat_core/chat_core.gd:870` and `client/godot/core/chat_core/chat_core.gd:896` as real elapsed time, as the ChatCore spec sets), `LogCore` (comment-only changes in `client/godot/core/log_core/log_core.gd`), the generated contract (`client/godot/generated/contract/core_contract.gd` adds only `LogoutOtherDevicesRequest`/`LogoutOtherDevicesResponse`, no chat message), and the generated core settings (no `ChatCore.*` key changed). `NetworkCore`, `EventCore`, `LocalDataCore`, `BadgeCore` and `UtilCore` have no change in the range. None of these changes alter a behavior ChatCore relies on
- ChatCore code and tests that the range does not reach were not reviewed again, as the commit range is not `none`
- `ogw core test godot ChatCore` passed on this checkout (job mw7toaocbc8330); it left no test record because the checkout has an uncommitted change (the deleted earlier `records/review/ChatCore-1.md`)
- Whether `TimeCore` real time keeps increasing during background under the new frame step was not checked: it is a `TimeCore` behavior outside this target
