## findings

none

## previous

none

## out of scope

- client/godot/core/chat_core/chat_core.gd:669: medium When a `Guild` poll on the way succeeds after a `load_older` of that channel ended with `GUILD_NOT_MEMBER` (`_check_not_member` at line 773 raises `w.epoch`), lines 669-671 set the next poll to `_failure_retry_ms`. `open-game-works-core/skills/client-core/modules/chat-core.md:87` sets `poll_after_ms` when the previous request succeeded. Run path: `watch_channel(GUILD, 0)`, poll pending, `load_older` gets `GUILD_NOT_MEMBER`, the poll response arrives with `poll_after_ms` smaller than `ChatCore.failureRetryMs`. The effect is only a later next request. This code is not in the commit range
- client/godot/core/chat_core/chat_core.gd:854: medium The `w.busy` branch of `_on_sent` (`w.kick`, and lines 682-685 of `_send_poll`) has no test. `chat-core.md:106` requires the poll to go right after a send, and without this branch a message sent during a poll waits for the next `poll_after_ms`. In `client/godot/core/chat_core/tests/`, `test_send.gd` holds no response pending, and the only pending `GET_MESSAGES` that coexists with a send (`test_channel_poll.gd:162`) belongs to `load_older` and ends with `release` before a send result. Removing the branch fails no test by reading the tests; this was not run. This code is not in the commit range
- client/godot/core/chat_core/chat_core.gd:773: medium `load_older` ending with `GUILD_NOT_MEMBER` has no test, and neither has the `epoch` branches that drop results after that reset (lines 669 and 768). `chat-core.md:93` applies to any request of a `Guild` channel, and the only test with that error is the poll in `client/godot/core/chat_core/tests/test_watch.gd:93`. Removing `_check_not_member` at line 773 fails no test by reading the tests; this was not run. This code is not in the commit range

## debt

none

## must fix

none

## unknown

- The commit range changes only `client/godot/core/localization_core/localization_core.gd`, its test and `records/`. No file of `client/godot/core/chat_core/` changed, and `git log` shows no ChatCore commit in the range. The only link to ChatCore is through `BadgeCore`, which calls `LocalizationCore.format` (`client/godot/core/badge_core/badge_core.gd:333`). The change is in `_restore_heading_types`, which restores the heading types of the font theme, and ChatCore uses no font, theme or localization operation
- No test was run: there was no finding to check. The ChatCore core tests were not run on this commit, so the absence of a regression comes from reading the range diff. The out-of-scope lines about tests come from reading `client/godot/core/chat_core/tests/`, with no restored defect
- Server core `chat` was read only from its spec (API, field, channel, send and receive sections up to report), to compare the fields and cursors that ChatCore uses. `server/core/chat/` code was not read: it is a separate review target
- `NetworkCore`, `EventCore`, `BadgeCore` and `LocalDataCore` code was read only at the operations ChatCore calls. Their failure paths beyond that were not checked
- Defining documents read only in part: `log-core.md`, `event-core.md`, `time-core.md`, `local-data-core.md`, `network-core.md` and `badge-core.md` at the parts ChatCore uses; `core/SKILL.md` at `## lifecycle`; `client-core/engines/godot.md` at `## API`, `## lifecycle` and `## frame code`; `core/command.md` at the lines about `ogw core test`; `client-core/SKILL.md` at the `ChatCore` row of the module table. A rule in the other parts was not compared with ChatCore
- `client/godot/core/chat_core/tests/support/chat_test_case.gd` was read only at the helpers the tests above use, and the fake network behavior behind them was not checked
