## done

- `testing` (server core): the settings type table `SETTING_TYPES` in `server/core/testing/dev/setting_types.ts` is a hand-written table of the spec type of every settings row of the core spec files (a game checkout has no `core-spec/`, so `start_test_server` checks settings overrides against it). No tool generates it, so it lacked the two `LocalizationCore` rows added in harness commit be23d98. Added `LocalizationCore.bodyFontWeight: 'integer'` and `LocalizationCore.headingFontWeight: 'integer'`, the `type` of those rows in `core-spec/LocalizationCore.json`
- The existing core test `register.test.ts` "the settings type table holds the type of every settings row of the core spec files" checks this. `ogw core test server testing` passes on SQLite and PostgreSQL. `ogw core dependents testing` lists no other module. `ogw code check core` passes

## spec proposals

- The table has to be edited by hand every time a settings row is added to a core spec, and the gap only shows up when the core tests run. One option: `ogw core spec` could write this table from `core-spec/` (as `ogw generate` writes the core settings type file of the Godot core project), and command.md could list it as a generated file. This changes the harness and spec, so a human has to decide it

## review

none

## unverified

none
