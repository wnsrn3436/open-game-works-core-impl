# review attendance round 1

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

- The commit range 2ef5ae8d3d40..b99875f64304 changes no file under `server/core/attendance/` and does not change `attendance.md`. The changes that reach code attendance calls or shares were checked: `storage` (`create_user` now picks a random user ID and a public code, `get_user_record` returns `public_code`, core schema version 2 with the public code start fill, `find_user_by_public_code`, `is_public_code_input`), `routing` (`BanDetail.public_code` in step 6, `FindUserByPublicCode` prepare and core rpc, `find_user_by_public_code` admin operation), `proto/ogw/core.proto` and the generated contract (new fields and messages only; `ClaimAttendanceRequest`, `ClaimAttendanceResponse` and `AttendanceUserState` are unchanged). attendance calls only `get_state`, `put_core_state`, `delete_core_state`, `with_hook_change_source` and `check_hook_output` of `storage`, none of which changed, and does not read user IDs or user records, so the changes cause or reveal no attendance problem
- The attendance tests (`server/core/attendance/tests/`, 7 files, 32 tests) were run on SQLite at b99875f and all passed. They were run with the server build data of `open-game-works-core-impl/server/build/data` because this checkout has no `server/build/data`; that build data was not checked to equal a build of `test-data/` at b99875f
- The attendance tests were not run on PostgreSQL: no PostgreSQL connection string was available to this review
- Client `UserStateCore.get_attendance` is a client core module and was not reviewed
