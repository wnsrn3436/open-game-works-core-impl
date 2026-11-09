# review InputCore round 1

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

- The commit range 625ae1894a26f0f1036a2b6817bd40a0c223e5bd..84c58681493db3c09a3cbdff774a38107af12a08 changes no file of InputCore (client/godot/core/input_core/, core-spec/InputCore.json, tools/data-tool/src/checks/InputCore.ts) and no file of the modules it depends on (EventCore, LogCore, TimeCore, LocalDataCore, ResolutionCore, InputBlockCore). The only DataCore change, the not-initialized branch of `DataCore.release` (client/godot/core/data_core/data_core.gd:58), is not on an InputCore code path: InputCore never calls `DataCore.release`
- The change of the range that reaches InputCore is that `BootstrapCore` shutdown now calls `release` on modules that are not initialized (client/godot/core/bootstrap_core/bootstrap_core.gd:1350). `InputCore.release` of a module that is not initialized returns at once without a log and without calling another module (client/godot/core/input_core/input_core.gd:271). InputCore has no values that operations called before `init` set: every DEV operation of client/godot/core/input_core/dev/input_core_dev.gd checks `is_initialized` first. So the change follows skills/core/SKILL.md:73. `ogw core test godot InputCore` passed on this checkout after the change (no test record, because the checkout had an uncommitted deletion of this review file)
- The browser run (`ogw core test godot InputCore --web`) was not run in this round
- Behavior with real gamepad and touch hardware was not checked
- Files of the commit range outside InputCore and its call paths (other client modules, server modules, records) were not reviewed
