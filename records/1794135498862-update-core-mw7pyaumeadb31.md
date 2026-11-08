# update core: core settings and base proto (job mw7pyaumeadb31)

## done

- Cherry-picked 0d4c6278 (job mw7pm69p209ac3, the core settings of this update) as c8fe1d02.
- `settings/core-settings.schema.json`: `auth.loginTokenIdleTtlMs` `minimum` 0 → 1 (harness 86cea35). `ogw settings describe core auth.loginTokenIdleTtlMs` gives `minimum 1`. The value in `core-settings.json` (15552000000) is unchanged. No generated file holds the range.
- `proto/ogw/core.proto` (6d677b07). I checked every base proto item that the specs changed since harness 3417ebc in two ways. First, the `ogw core test` base proto check (`tools/src/commands/core/lib/base-proto-check.ts`), run on its own: before the edit it reported only `LogoutOtherDevices`. Second, a script comparing core.proto with the prose `<message>` fields lists and the `(base proto enum)` lists of all server-core, client-core and contract specs. I also listed every PascalCase name in the added spec lines and looked up each one that is not in core.proto: all of them are client types, data enums or hook types. `ItemChangeSource` `IapRefund` and the `MatchmakerFrameKind` list already match core.proto, and `base-proto.md` (`CoreError`, core UserState kinds) did not change. Additions, all appended, nothing renumbered:
  - `service Core`: `rpc LogoutOtherDevices(LogoutOtherDevicesRequest) returns (LogoutOtherDevicesResponse)` with `option (ogw.retry) = true` and `// changes: none`, after `Logout`; empty messages `LogoutOtherDevicesRequest` and `LogoutOtherDevicesResponse` after `LogoutResponse` (the auth.md `## API` row has input `none` and output `none`).
  - `MatchmakerFrame`: `bool forfeit = 26`, `string platform = 27`.
  - `MatchJudgeStatus`: `MATCH_JUDGE_STATUS_FORFEIT = 4`.
- Generated code from the contract tool, made by `ogw core test` from the new base proto: `server/generated/contract/core_contract.ts` (7c12b8d5) and `client/godot/generated/contract/core_contract.gd` (a7f95f7d). No core test data file needed a change, because nothing in it uses the new items.
- The benchmark game `benchmark/godot/` (36640a2f): I ran the contract tool (`tools/contract-tool/bin/contract-tool.js --game <copy> --engine godot --base-proto proto --core-settings settings/core-settings.json`) on a copy of `benchmark/godot/`. The only files that differed were `client/generated/contract/core_contract.gd` and `server/generated/contract/core_contract.ts`, so I copied those two into the benchmark. The `.ts` is byte-identical to the core one, and the `.gd` diff is the same as the core one. The input did not name the benchmark. I updated it so that its generated core contract matches the base proto it is released with, as commit baad073b did before.
- No module behaviour was implemented, and no handler stub was needed. routing collects core rpc handlers only for the names in `MODULE_CORE_RPCS` (`server/core/routing/spec_tables.ts:114`), and `LogoutOtherDevices` is not in auth's list. So server start does not need a handler, and a `core/LogoutOtherDevices` request takes the existing path of an rpc that has no handler. Nothing reads `MatchmakerFrame.forfeit`/`platform` or produces `FORFEIT` yet. The auth and matchmaker module jobs have to add `LogoutOtherDevices` to `MODULE_CORE_RPCS` of `auth` and implement these.
- Tests on HEAD 36640a2f, clean checkout, test record left:
  - `ogw core test server`: every module passes.
  - `ogw core test godot`: every module passes, including the render modules (AccessibilityCore, ResolutionCore, NativeUiCore, QACore, VirtualPadCore). The screen was unlocked for this run. The earlier run, before the Godot generated commit, had them `unknown (screen locked)`.
  - `ogw code check core`: type check, lint, dependency and secret all pass.
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written.

## spec proposals

none

## review

none

## unverified

- `server/core/matchmaker/tests/rooms.test.ts` "answers ROOM_START and a host MATCH_REQUEST with ROOM_BUSY ... after that member MATCH_LEAVE" failed once on PostgreSQL (`expected [...] to have a length of 1 but got 2`, at `participants(h, match_id).filter((p) => p.left_at === 0n)` after a `MATCH_LEAVE`). It passed in the other 4 runs: 2 full server runs and 3 `--file rooms.test.ts` runs. I did not reproduce the cause. My guess is that the test reads `left_at` before the async game transaction of the `LEFT` change has committed on PostgreSQL. This job did not change the code it runs: the current matchmaker does not read the new `forfeit` field. I did not fix it, because the matchmaker module job rewrites the `MATCH_LEAVE`/`left_at` behaviour (`forfeit` `false` no longer writes `left_at`) and this test with it.
