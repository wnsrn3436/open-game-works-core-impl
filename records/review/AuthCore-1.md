# review AuthCore round 1

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

- The range 9b1e14b5..78b28f0c changes no file under client/godot/core/auth_core/ and does not change core-spec/AuthCore.json, proto/ or server/core/auth/. The last commit that changed client/godot/core/auth_core/ is 9b5616b, before the range. Input `## spec changes` is `none`
- Of the dependency modules of AuthCore, the range changes non-test code only in MessageCore (`show_black_box` loses its extra text parameter, client/godot/core/message_core/message_core.gd:128) and LocalizationCore (`list_languages` takes `PackedInt32Array`, client/godot/core/localization_core/localization_core.gd:304). AuthCore calls only `MessageCore.show_toast` (client/godot/core/auth_core/auth_core.gd:548, :1271, :1278), whose signature does not change (client/godot/core/message_core/message_core.gd:124). A search of client/godot/core/auth_core/, its adapters, DEV code and tests found no use of `show_black_box` or `list_languages`
- The other client changes of the range were read: bootstrap_core tests, payment_core (a comment only, in `_process_transaction`), qa_core (settings reads removed) and the generated settings. A search of client/godot/core/auth_core/ found no use of `uiCheckScreens`, `uiQuality`, `gamepadSupported`, `supportedLanguages` or `AccessibilityCore.textScales`. All 17 settings keys of core-spec/AuthCore.json are present in client/godot/generated/core_settings.json with the type core-spec/AuthCore.json declares, read by a script at 78b28f0c
- The data tool changes of the range (tools/data-tool/src/corespec.ts, tools/data-tool/src/godotgen.ts, tools/data-tool/src/checks/NoticeCore.ts) were read. core-spec/AuthCore.json has empty `tables`, `usedTables` and `enums`, and none of its 38 `reserved` entries has a `rowOf`, so the table closure and vector list changes have no AuthCore input. The generated `ReservedString` that AuthCore uses was not compared before and after the range, and only the core test below covers it
- `ogw core test godot AuthCore MessageCore` reported `pass` for both modules. The output does not say whether the modules ran again or a kept passing result was used. client/, tools/, settings/ and core-spec/ are the same at 78b28f0c and at main fd6e235, so the result applies to the reviewed commit whichever of the two it ran on. The Web run (`ogw core test godot --web`) and the tests of the modules that depend on AuthCore were not run
- The edits of skills/client-core/modules/auth-core.md since f0b9bf8 (commits 2cdaf2e, 5b117a6, 45ad001) were read because they are after the last AuthCore code change. They change wording only ("emits" to "publishes", "per-engine" to "engine-specific", "a build that contains DEV code" to "the environments that include DEV code", and a removed `{date}` line that repeats the `update_push_consent` rule). No behavior was compared to code beyond that reading
- Because the range does not reach AuthCore code, the rest of client/godot/core/auth_core/ and its tests were not reviewed against the spec in this round, so this file does not state that they match it. Only the parts named above were read
- records/review-debt/AuthCore.json holds 1 item and records/review-debt/spec-AuthCore.json holds none. This round's input `## debt` and `## must fix` are `none`, so that item was not judged and stays in the list
