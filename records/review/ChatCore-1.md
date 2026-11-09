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

- The commit range 625ae189..a19c65ed changes no file under `client/godot/core/chat_core/`, no `core-spec/ChatCore.json` or `core-spec/chat.json`, no `server/core/chat/` file and not `tools/data-tool/src/checks/ChatCore.ts`; input `## spec changes` is `none`. Of the ChatCore dependencies (`LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `NetworkCore`, `BadgeCore`), only `client/godot/core/network_core/network_core.gd:146` changes in the range: `NetworkCore.release` of a module that is not initialized now sets the transport to null. ChatCore calls `NetworkCore.send` only while initialized and started (`client/godot/core/chat_core/chat_core.gd:380`, `client/godot/core/chat_core/chat_core.gd:664`, `client/godot/core/chat_core/chat_core.gd:761`, `client/godot/core/chat_core/chat_core.gd:830`), and the ChatCore tests initialize `NetworkCore` in every test (`client/godot/core/chat_core/tests/support/chat_test_case.gd:96`), so the change does not reach ChatCore
- Commit ad967246 makes DEV `BootstrapCore.shutdown` call `release` of every module, also of one that is not initialized (`client/godot/core/bootstrap_core/bootstrap_core.gd:1350`). `ChatCore.release` of a module that is not initialized returns at once (`client/godot/core/chat_core/chat_core.gd:107`). ChatCore has no operation that sets a value before `init`: `init` sets every static value (`client/godot/core/chat_core/chat_core.gd:85`-`client/godot/core/chat_core/chat_core.gd:102`) and every failed `init` path after the node is added resets the state (`client/godot/core/chat_core/chat_core.gd:97`), and the deferred calls check the session object (`client/godot/core/chat_core/chat_core.gd:579`, `client/godot/core/chat_core/chat_core.gd:891`). So no ChatCore value stays across a shutdown between tests
- ChatCore code and tests that the range does not reach were not reviewed again, as the commit range is not `none`
- `ogw core test godot ChatCore` passed on this checkout (job mw8la6ly45226e); it left no test record because the checkout has an uncommitted change (the deleted earlier `records/review/ChatCore-1.md`)
