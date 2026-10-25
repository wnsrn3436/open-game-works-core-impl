# BootstrapCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/bootstrap_core/tests/test_boot_login.gd:53 | The range renames the ban popup format argument from `user_id` to `public_code` and groups it (client/godot/core/bootstrap_core/bootstrap_core.gd:966-977, 1003-1013), per bootstrap-core.md `ban body` and `[bootstrap_banned_deletion]`. The tests (test_boot_login.gd:53, 64, 68, 80, 85) compare only the trace line `UICore.open_system_popup ... args=<args_text>`, and `args_text` is a separate string that `_login_failed` / `_on_deletion_pressed` build from the local `public_code` (bootstrap_core.gd:976, 1012), not from `param.format_args` (bootstrap_core.gd:1056-1057, 1068). Run path: change `args.set_string("public_code", public_code)` at bootstrap_core.gd:968 or 1006 back to `args.set_string("user_id", ...)`, or pass `result.public_code` ungrouped to `set_string` while keeping the trace; every test still passes, while the popup body `{public_code}` has no value (or the ungrouped code). No test reads the `FormatArgs` given to `UICore.open_system_popup` or the rendered body | Make the trace text come from the `FormatArgs` actually put in `SystemPopupParam` (for example a DEV-only dump of its names and values in `_open_failure_popup`), or assert the rendered popup body text, so a wrong key or value of `public_code` fails the test | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range changes BootstrapCore at client/godot/core/bootstrap_core/bootstrap_core.gd:963-1015 (`public_code` format argument, `_grouped_public_code`), core-spec/BootstrapCore.json:140-190 (format argument names), and the tests client/godot/core/bootstrap_core/tests/test_boot_login.gd:48-90 and tests/support/boot_test_network.gd. These were checked against bootstrap-core.md lines 93-95, 193-195 and 251 and auth-core.md `LoginResult`, `get_public_code` and ban session. `_grouped_public_code` returns a code whose length is not 8 unchanged; the defining documents set only the 8-character and empty cases, so that is not a finding
- The tests were read, not run, and the mutation of R1-1 was traced by reading the code, not run
- The other changes of the range (AuthCore, SoundCore, TweenCore, server core, contract, benchmark content, records/) are outside the target and were reviewed only where BootstrapCore reads them (`LoginResult.public_code` filled from `BanDetail.public_code` at client/godot/core/auth_core/auth_core.gd:759)
