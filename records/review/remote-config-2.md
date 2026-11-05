## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `server/core/admin-api/body.ts:61` (`string_of`) now refuses a `string` field value holding U+0000, and the `admin-api` spec (`skills/server-core/modules/admin-api.md:178`) states it, so it applies to every `string` field of an admin operation, `salt` of `put_experiment` (`server/core/remote-config/index.ts:386`, `:488`) included. Run on a SQLite test server (scratch test in `server/core/remote-config/tests/`, removed afterwards): `put_experiment` with `salt` `"a\u0000b"` answers `bad_request` (was `internal` in round 1), a group `name` holding U+0000 answers `bad_request`, and a `String` group value holding U+0000 is accepted and stored escaped through `encode_stored` (`server/core/remote-config/values.ts:85`, `JSON.stringify`), so no raw U+0000 reaches a DB text parameter |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The module code of `server/core/remote-config/` is unchanged in the range. The range changes `admin-api` (`body.ts` U+0000 refusal and its tests), `block-report`, `live-event`, `mission` and `public-profile`. Only the `admin-api` change reaches the calls remote-config makes. The spec change (`admin operation. Collection and handling follow admin-api.`) moves no behavior that the remote-config code or tests depend on
- The remote-config core tests were run on SQLite only (7 files, 38 passed). They were not run on PostgreSQL because this review had no PostgreSQL test instance
