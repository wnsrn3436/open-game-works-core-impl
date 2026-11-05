# review: mission round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | open | The range `5cfab30..1b8ce0f` changes no file under `server/core/mission/` (`git diff --stat` on that path: 0 files). `add_progress` still calls `read(ctx, row)` once per in-window mission of the counter (`server/core/mission/index.ts:155`), and `read` (`index.ts:121`) still calls `storage.get_state` with one item ID, so one call runs one `SELECT` per in-window `mission` row of that counter. The range adds `storage.get_states` with caller `mission` (`open-game-works-core/skills/server-core/modules/storage.md:29`, `:88`), implemented as one query in `server/core/storage/state.ts:168` and exposed in `server/core/storage/index.ts:138`, but `MissionStorage` still picks only `get_state` (`server/core/mission/deps.ts:10`) and mission does not call `get_states` anywhere (`grep get_states server/core/mission`: 0 hits). Fix direction: add `get_states` to `MissionStorage` and read the stored rows of the in-window missions of the counter with one `get_states` call before the loop |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the mission tests. `vitest run server/core/mission` outside `ogw core test` fails at fixture setup (`OGW_DEFAULT_DB`, then `load_data` in `server/core/testing/dev/fixtures.ts:88`) before any test runs. No mission code changed in the range. I compared the storage code mission calls (`get_state`, `put_core_state`, `with_hook_change_source`, `check_hook_output`) with the changed storage spec by reading it only; the changes in `server/core/storage/state.ts` add `get_states` and do not change `get_state`
- The spec changes in `item-ledger.md`, `mailbox.md`, `logging.md`, `storage.md`, `core/SKILL.md`, `core/command.md` and `server-core/SKILL.md` were checked against what mission calls (`grant_or_mail` input, output and result forms, the `ItemAmount` list of `reward`, the change source and `once_key` rules, `track_core_event`, the storage operations above). None of them changes behavior that mission relies on, except the new `get_states` (R3-1)
- The other changes in the range (other modules, client, tools, test data) were not reviewed: none of them is code that mission calls or that calls mission, except the storage files above
- The places in `## unknown` of `records/review/mission-3.md` (the `FAILED` conversion of a row of a lower contract version, the dependents of `mission`) are still unchecked
