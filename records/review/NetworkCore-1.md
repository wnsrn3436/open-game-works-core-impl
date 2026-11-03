# review NetworkCore round 1

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

- The range 9b1e14b5..556a0959 changes no file under client/godot/core/network_core/ and does not change core-spec/NetworkCore.json. It also changes nothing under the folders of LogCore, EventCore, TimeCore, DataCore, UserStateCore, InputBlockCore and UICore, under server/core/session and server/core/logging, or under proto/
- Of the dependency modules, only MessageCore changes: `show_black_box` loses its extra text (client/godot/core/message_core/message_core.gd:128). NetworkCore calls only `MessageCore.show_toast` with extra text (client/godot/core/network_core/network_core.gd:1038), and `show_toast` is unchanged and matches client-core message-core.md
- The other client changes of the range were read: bootstrap_core tests, localization_core (`list_languages` parameter type), payment_core (a comment), qa_core (settings reads removed) and generated settings. network_core does not call `list_languages`. The payment_core comment says `NetworkCore` leaves the failure log, which matches `_end_failure` (client/godot/core/network_core/network_core.gd:1144). The hunks of the settings files do not touch a `NetworkCore.*` key or `InputBlockCore.maxDurationMs`
- The data tool changes of the range (tools/data-tool/src/corespec.ts, tools/data-tool/src/godotgen.ts, tools/data-tool/src/checks/NoticeCore.ts) were read. Under client/godot/generated/ the range changes only core_settings.json and core_settings_types.json, so the committed generated code NetworkCore uses (`ReservedString`, `CoreContract`) is unchanged. Whether the changed generator would give different output for the core test data was not traced separately, and only the core test below covers it
- `ogw core test godot NetworkCore` reported `pass`. The output does not say whether the module ran again or a kept passing result was used. Tests of the modules that depend on NetworkCore were not run, and the Web run (`ogw core test godot --web`) was not run, so client/godot/core/network_core/web_network_transport.gd was read only
- client/godot/core/network_core/network_core.gd, the transports and the DEV code were read for the interactions above, and no problem with evidence was found in them. They were not compared line by line with every item of `## test` of the spec, and the tests under client/godot/core/network_core/tests/ were not read except where named here, so this file does not state that the module matches the spec. The server side of the signature and the headers was compared only with session.md `### request signature`, not with server code
- Not decided: a `Retry` request whose last failure came from `SessionProvider` and whose retry popup closes without retry ends with no log (client/godot/core/network_core/network_core.gd:1144). network-core.md `### failure flow` says both that such a popup end leaves an error log and that a failure `SessionProvider` returned leaves no failure log. This was not run, and the documents do not settle which rule wins, so it is not written as a problem
