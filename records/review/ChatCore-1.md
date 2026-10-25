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

- No file under `client/godot/core/chat_core/` changed in the range `2ef5ae8d..2cff9e91`. The changes that reach ChatCore are the generated contract (`client/godot/generated/contract/core_contract.gd`: `public_code` field 5 of `PublicProfileEntry`, which is field `profile` of `ChatChannelEntry`) and the generated core settings (new `SoundCore.*` keys, used by `SoundCore.init` in `client/godot/core/chat_core/tests/support/chat_test_case.gd:94`). The channel list change check `_same_entry` (`client/godot/core/chat_core/chat_core.gd:420`) compares `encode()` of whole entries, and the generated `PublicProfileEntry.encode` writes `public_code`, so a change of only `public_code` emits `ChatChannelsChangedEvent` as `## behavior` `### channel list` requires. No test sends a list that differs only in `public_code`; the spec has no `## test` item for it
- The ChatCore core tests were not run in this review. The run log `records/1792947513155-update-core-mvo2nn7kb4e445-runs.json` records `ogw core test godot` with ChatCore at the end of the range passing (1399/1399, and `--web` 1393/1393)
- ChatCore code outside the places above (polling, watch, older messages, send, release, read seq storage) was not read in this round, because the range changes do not reach it
